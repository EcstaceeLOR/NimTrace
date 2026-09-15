import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicProductResponse, PurchaseIntentResponse } from '@nimtrace/contracts'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProductCheckout } from './ProductCheckout'

const product: PublicProductResponse = {
  currentVersion: 1,
  description: 'Repairable wireless headphones.',
  id: 'product-id-with-enough-entropy',
  imageUrl: '/demo-product.svg',
  issuedAt: '2026-09-14T12:00:00.000Z',
  issuerAddress: 'NQ11 SELL 0000 0000 0000 0000 0000 0000 0000',
  priceLuna: 100000,
  proofHash: 'a'.repeat(64),
  serialFingerprint: 'b'.repeat(12),
  signatureState: 'verified',
  state: 'available',
  title: 'NimTrace Headphones',
  version: 1,
  warrantyDurationDays: 365,
  warrantySummary: 'Manufacturing defects are covered for one year.',
}

const intent: PurchaseIntentResponse = {
  amountLuna: 100000,
  buyerAddress: 'NQ22 BUYE 0000 0000 0000 0000 0000 0000 0000',
  createdAt: '2026-09-14T12:00:00.000Z',
  expiresAt: '2099-09-14T12:10:00.000Z',
  id: 'abcdefghijklmnopqrstuvwx',
  network: 'test-albatross',
  productId: product.id,
  productVersion: 1,
  sellerAddress: product.issuerAddress,
  status: 'pending',
  transactionData: 'NTP1:abcdefghijklmnopqrstuvwx',
}

const authentication = {
  status: 'success' as const,
  session: {
    expiresAt: '2099-09-15T12:00:00.000Z',
    sessionToken: 'session-token-with-enough-entropy-to-be-valid-12345',
    walletAddress: intent.buyerAddress,
  },
}

function storage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

function wallet(payment: unknown = { status: 'success', value: { transactionHash: 'd'.repeat(64) } }) {
  return {
    checkConsensus: vi.fn().mockResolvedValue({ status: 'success', value: { established: true, blockNumber: 42 } }),
    deepLink: vi.fn().mockReturnValue('nimiqpay://miniapp?url=product'),
    isAvailable: vi.fn().mockReturnValue(true),
    pay: vi.fn().mockResolvedValue(payment),
  }
}

function submission(transactionHash = 'd'.repeat(64)) {
  return new Response(JSON.stringify({ id: intent.id, status: 'submitted', transactionHash }))
}

function verification(
  state: 'verified' | 'pending' | 'rejected' | 'inconclusive' = 'pending',
  transactionHash: string | null = 'd'.repeat(64),
) {
  return new Response(JSON.stringify({
    blockHeight: state === 'verified' ? 120 : null,
    checkedAt: '2026-09-14T12:01:00.000Z',
    confirmations: state === 'verified' ? 60 : null,
    finalityConfirmations: 60,
    id: intent.id,
    reason: state === 'verified' ? 'verified_final' : state === 'inconclusive' ? 'provider_unavailable' : 'transaction_not_found',
    state,
    transactionHash,
  }))
}

describe('ProductCheckout', () => {
  it('shows a complete review and sends only exact server intent values once', async () => {
    const checkoutWallet = wallet()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(intent), { status: 201 }))
      .mockResolvedValueOnce(submission())
      .mockResolvedValueOnce(verification())

    render(<ProductCheckout
      authenticate={vi.fn().mockResolvedValue(authentication)}
      fetcher={fetcher}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={storage()}
      wallet={checkoutWallet}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Buy with NIM' }))
    expect(await screen.findByRole('heading', { name: 'Review before paying' })).toBeInTheDocument()
    expect(screen.getByText(product.title)).toBeInTheDocument()
    expect(screen.getByText(intent.sellerAddress)).toBeInTheDocument()
    expect(screen.getAllByText('1 NIM')).toHaveLength(1)
    expect(screen.getByText('365 days')).toBeInTheDocument()
    expect(checkoutWallet.pay).not.toHaveBeenCalled()

    const payButton = screen.getByRole('button', { name: 'Pay 1 NIM' })
    fireEvent.click(payButton)
    fireEvent.click(payButton)

    expect(await screen.findByText('Payment submitted')).toBeInTheDocument()
    expect(screen.getByText(/not yet a completed purchase/i)).toBeInTheDocument()
    expect(checkoutWallet.pay).toHaveBeenCalledTimes(1)
    expect(checkoutWallet.pay).toHaveBeenCalledWith({
      recipient: intent.sellerAddress,
      valueLuna: intent.amountLuna,
      data: intent.transactionData,
      validityStartHeight: 42,
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/payment-intents/${intent.id}/submissions`, expect.objectContaining({
      body: JSON.stringify({ transactionHash: 'd'.repeat(64) }),
    }))
  })

  it('treats cancellation as safe to retry and clears the uncertain-payment marker', async () => {
    const checkoutWallet = wallet({ status: 'cancelled', code: 'USER_CANCELLED' })
    const checkoutStorage = storage()
    render(<ProductCheckout
      authenticate={vi.fn().mockResolvedValue(authentication)}
      fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify(intent), { status: 201 }))}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={checkoutStorage}
      wallet={checkoutWallet}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Buy with NIM' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay 1 NIM' }))

    expect(await screen.findByText('Payment cancelled. No funds moved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay 1 NIM' })).toBeEnabled()
    expect(checkoutStorage.removeItem).toHaveBeenCalled()
  })

  it('blocks another payment after a delayed provider result', async () => {
    const checkoutStorage = storage()
    render(<ProductCheckout
      authenticate={vi.fn().mockResolvedValue(authentication)}
      fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify(intent), { status: 201 }))}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={checkoutStorage}
      wallet={wallet({
        status: 'error',
        error: { code: 'CONFIRMATION_DELAYED', message: 'Confirmation is delayed.', retryable: true },
      })}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Buy with NIM' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay 1 NIM' }))

    expect(await screen.findByText('Payment result delayed')).toBeInTheDocument()
    expect(screen.getByText(/do not pay again/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay 1 NIM' })).not.toBeInTheDocument()
    expect([...checkoutStorage.values.values()][0]).toContain('awaiting_wallet')
  })

  it('retries only the saved hash when the API was unavailable', async () => {
    const checkoutWallet = wallet()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(intent), { status: 201 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(submission())
      .mockResolvedValueOnce(verification())
    render(<ProductCheckout
      authenticate={vi.fn().mockResolvedValue(authentication)}
      fetcher={fetcher}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={storage()}
      wallet={checkoutWallet}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Buy with NIM' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay 1 NIM' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry status update' }))

    await waitFor(() => expect(screen.getByText('Payment submitted')).toBeInTheDocument())
    expect(checkoutWallet.pay).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('reconciles an interrupted wallet request before offering another payment', async () => {
    const checkoutStorage = storage()
    checkoutStorage.values.set(`nimtrace:checkout:${product.id}`, JSON.stringify({
      intent,
      stage: 'awaiting_wallet',
    }))
    const checkoutWallet = wallet()
    const fetcher = vi.fn().mockResolvedValue(verification('verified'))

    const authenticate = vi.fn().mockResolvedValue(authentication)
    render(<StrictMode><ProductCheckout
      authenticate={authenticate}
      fetcher={fetcher}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={checkoutStorage}
      wallet={checkoutWallet}
    /></StrictMode>)

    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument()
    expect(checkoutWallet.pay).not.toHaveBeenCalled()
    expect(authenticate).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(`/api/payment-intents/${intent.id}/verification`, expect.objectContaining({
      headers: { Authorization: `Bearer ${authentication.session.sessionToken}` },
    }))
    expect(checkoutStorage.removeItem).toHaveBeenCalled()
  })

  it('restores a captured hash idempotently and checks it without reopening Nimiq Pay', async () => {
    const checkoutStorage = storage()
    checkoutStorage.values.set(`nimtrace:checkout:${product.id}`, JSON.stringify({
      intent,
      stage: 'hash_captured',
      transactionHash: 'd'.repeat(64),
    }))
    const checkoutWallet = wallet()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(submission())
      .mockResolvedValueOnce(verification('inconclusive'))

    render(<ProductCheckout
      authenticate={vi.fn().mockResolvedValue(authentication)}
      fetcher={fetcher}
      product={product}
      publicUrl="https://nimtrace.example/products/test"
      storage={checkoutStorage}
      wallet={checkoutWallet}
    />)

    expect(await screen.findByText('Payment submitted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check payment status' })).toBeInTheDocument()
    expect(checkoutWallet.pay).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/payment-intents/${intent.id}/submissions`, expect.objectContaining({
      body: JSON.stringify({ transactionHash: 'd'.repeat(64) }),
    }))
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/payment-intents/${intent.id}/verification`, expect.anything())
    expect([...checkoutStorage.values.values()][0]).not.toContain(authentication.session.sessionToken)
  })
})
