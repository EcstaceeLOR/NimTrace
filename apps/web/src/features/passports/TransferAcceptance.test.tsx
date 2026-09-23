import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'
import { TransferAcceptance } from './TransferAcceptance'

const recipient = 'NQ22 BUYE 0000 0000 0000 0000 0000 0000 0000'
const owner = 'NQ11 SELL 0000 0000 0000 0000 0000 0000 0000'
const passportId = 'abcdefghijklmnopqrstuvwx'
const paymentIntentId = 'zyxwvutsrqponmlkjihgfedc'
const intentId = 'transfer-intent-123456789'
const transactionHash = 'b'.repeat(64)
const hash = (character: string) => character.repeat(64)

vi.mock('../../lib/nimiq/auth', () => ({
  authenticateWallet: vi.fn().mockResolvedValue({
    status: 'success',
    session: { sessionToken: 'secret-session-token', walletAddress: recipient },
  }),
}))

vi.mock('../../lib/nimiq/wallet', () => ({
  nimiqPayWallet: {
    isAvailable: vi.fn(() => true),
    pay: vi.fn(),
    sign: vi.fn(),
  },
}))

const passport = {
  checkedAt: '2026-09-23T10:00:00.000Z',
  eventChain: {
    eventCount: 1,
    events: [{
      createdAt: '2026-09-20T10:00:00.000Z',
      eventHash: hash('e'),
      maskedActor: 'NQ11…0000',
      previousEventHash: null,
      sequence: 1,
      type: 'issued',
    }],
    headEventHash: hash('e'),
    state: 'verified',
  },
  id: passportId,
  merchantClaims: { description: 'Headphones', warrantySummary: 'One year warranty' },
  overallState: 'verified',
  ownership: { maskedCurrentOwner: 'NQ11…0000', state: 'verified' },
  product: {
    imageUrl: '/demo-product.svg',
    issuerAddress: owner,
    payloadHash: hash('c'),
    state: 'verified',
    title: 'NimTrace Headphones',
    version: 1,
  },
  publicUrl: `https://nimtrace.vercel.app/passports/${passportId}`,
  purchase: {
    blockHeight: 123,
    confirmedAt: '2026-09-20T10:00:00.000Z',
    reason: 'confirmed',
    state: 'verified',
    transactionHash: hash('a'),
  },
  status: 'transfer_pending',
  warranty: {
    daysRemaining: 300,
    expiresAt: '2027-09-20T10:00:00.000Z',
    startedAt: '2026-09-20T10:00:00.000Z',
    state: 'active',
  },
}

function transfer(priceLuna: number, overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: '2026-09-24T10:00:00.000Z',
    fromAddress: owner,
    id: intentId,
    passportId,
    paymentIntentId: null,
    priceLuna,
    status: 'pending_recipient',
    toAddress: recipient,
    transactionData: null,
    version: 1,
    ...overrides,
  }
}

function fetcherFor(priceLuna: number) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(transfer(priceLuna))))
    .mockResolvedValueOnce(new Response(JSON.stringify(passport)))
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial) values.set(`nimtrace:transfer:${intentId}`, initial)
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('TransferAcceptance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('labels a zero-price transfer as a free gift before signature', async () => {
    render(<TransferAcceptance fetcher={fetcherFor(0)} intentId={intentId} storage={memoryStorage()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review with Nimiq Pay' }))

    expect(await screen.findByText('Free gift')).toBeInTheDocument()
    expect(screen.getByText('No NIM payment')).toBeInTheDocument()
    expect(screen.getByText(/no NIM payment will be requested/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign acceptance' })).toBeInTheDocument()
  })

  it('shows paid resale price and sequence before signature', async () => {
    render(<TransferAcceptance fetcher={fetcherFor(100_000)} intentId={intentId} storage={memoryStorage()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review with Nimiq Pay' }))

    expect(await screen.findByText('Paid resale')).toBeInTheDocument()
    expect(screen.getByText(/direct .*NIM payment to the current owner/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign acceptance, then pay' })).toBeInTheDocument()
  })

  it('resumes a captured payment hash without asking the wallet to pay again', async () => {
    const accepted = transfer(100_000, {
      paymentIntentId,
      status: 'accepted',
      transactionData: 'NTR-RESALE-1234',
    })
    const storage = memoryStorage(JSON.stringify({
      intent: accepted,
      recipientAddress: recipient,
      stage: 'hash_captured',
      transactionHash,
    }))
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ transactionHash })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...accepted, status: 'completed' })))

    render(<TransferAcceptance fetcher={fetcher} intentId={intentId} storage={storage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved transfer' }))

    expect(await screen.findByRole('heading', { name: 'Passport received' })).toBeInTheDocument()
    expect(nimiqPayWallet.pay).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/payment-intents/${paymentIntentId}/submissions`, expect.objectContaining({ method: 'POST' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/transfer-intents/${intentId}/complete-payment`, expect.objectContaining({ method: 'POST' }))
    expect(storage.removeItem).toHaveBeenCalledWith(`nimtrace:transfer:${intentId}`)
  })

  it('keeps recovery locked to the recipient wallet', async () => {
    const { authenticateWallet } = await import('../../lib/nimiq/auth')
    vi.mocked(authenticateWallet).mockResolvedValueOnce({
      status: 'success',
      session: { sessionToken: 'wrong-session', walletAddress: 'NQ33 OTHE 0000 0000 0000 0000 0000 0000 0000', expiresAt: '2099-01-01T00:00:00.000Z' },
    })
    const accepted = transfer(100_000, { paymentIntentId, status: 'accepted', transactionData: 'NTR-RESALE-1234' })
    const storage = memoryStorage(JSON.stringify({ intent: accepted, recipientAddress: recipient, stage: 'submitted', transactionHash }))
    const fetcher = vi.fn<typeof fetch>()

    render(<TransferAcceptance fetcher={fetcher} intentId={intentId} storage={storage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved transfer' }))

    await waitFor(() => expect(screen.getByText(/different wallet cannot recover it/i)).toBeInTheDocument())
    expect(fetcher).not.toHaveBeenCalled()
    expect(nimiqPayWallet.pay).not.toHaveBeenCalled()
  })
})
