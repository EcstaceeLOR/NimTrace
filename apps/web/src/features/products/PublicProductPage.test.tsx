import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicProductPage } from './PublicProductPage'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') },
}))

const product = {
  currentVersion: 1,
  description: 'Repairable wireless headphones.',
  id: 'product-id-with-enough-entropy',
  imageUrl: '/demo-product.svg',
  issuedAt: '2026-09-14T12:00:00.000Z',
  issuerAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
  priceLuna: 100000,
  proofHash: 'a'.repeat(64),
  serialFingerprint: 'b'.repeat(12),
  signatureState: 'verified',
  state: 'available',
  title: 'NimTrace Headphones',
  version: 1,
  warrantyDurationDays: 730,
  warrantySummary: 'Manufacturing defects are covered for two years.',
} as const

describe('PublicProductPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders proof, exact price, warranty, QR, and explicit wallet actions without prompting', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(product)))
    vi.stubGlobal('fetch', fetcher)

    render(<PublicProductPage productId={product.id} />)

    expect(await screen.findByRole('heading', { name: product.title })).toBeInTheDocument()
    expect(screen.getByText('1 NIM')).toBeInTheDocument()
    expect(screen.getByText('✓ Signature verified')).toBeInTheDocument()
    expect(screen.getByText('730 days')).toBeInTheDocument()
    expect(screen.getByText(product.issuerAddress)).toBeInTheDocument()
    expect(screen.getByText(product.serialFingerprint)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /QR code.*verification/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Buy with NIM' }))
      .toHaveAttribute('href', expect.stringMatching(/^nimiqpay:\/\/miniapp\?url=/))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^/api/products/${product.id}\\?live=\\d+$`)),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('shows the real checkout stage before another buyer can enter checkout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...product,
      checkoutProgress: {
        blockHeight: 12345,
        checkedAt: '2026-09-24T00:02:00.000Z',
        confirmations: 24,
        finalityConfirmations: 60,
        finalityReached: false,
        included: true,
        transactionDetected: true,
      },
      state: 'checked_out',
    }))))

    render(<PublicProductPage productId={product.id} />)

    expect(await screen.findByText('Checkout in progress', { selector: '.product-state' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checkout in progress' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Purchase progress' })).toBeInTheDocument()
    expect(screen.getByText('Included in block 12345.')).toBeInTheDocument()
    expect(screen.getByText(/24 \/ 60 confirmations/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Network finality confirmations' })).toHaveAttribute('aria-valuenow', '24')
    expect(screen.getByText(/buyer identity, payment tag, and transaction hash stay private/i)).toBeInTheDocument()
    expect(screen.getByText(/another buyer currently has an active checkout/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Buy with NIM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in Nimiq Pay' })).not.toBeInTheDocument()
  })

  it('labels a sold product as completed and keeps buying disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...product,
      state: 'owned',
    }))))

    render(<PublicProductPage productId={product.id} />)

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Purchase completed' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Buy with NIM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in Nimiq Pay' })).not.toBeInTheDocument()
  })

  it.each(['suspended', 'replaced', 'invalid'] as const)('blocks purchases for an honest %s state', async (state) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...product,
      signatureState: state === 'invalid' ? 'invalid' : 'verified',
      state,
    }))))

    render(<PublicProductPage productId={product.id} />)

    expect(await screen.findByRole('button', { name: 'Purchase unavailable' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Buy with NIM' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in Nimiq Pay' })).not.toBeInTheDocument()
  })
})
