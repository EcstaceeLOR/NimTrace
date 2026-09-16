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
      .toHaveAttribute('href', expect.stringMatching(/^https:\/\/nimpay\.app\/miniapps\/open\//))
    expect(fetcher).toHaveBeenCalledTimes(1)
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
  })
})
