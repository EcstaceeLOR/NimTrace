import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { PublicPassportVerification } from './PublicPassportVerification'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') },
}))

const passport = {
  checkedAt: '2026-09-15T10:00:00.000Z',
  eventChain: {
    eventCount: 1,
    events: [{
      createdAt: '2026-09-14T12:00:00.000Z',
      eventHash: 'c'.repeat(64),
      maskedActor: 'NQ12TE••••••000000',
      previousEventHash: null,
      sequence: 1,
      type: 'issued',
    }],
    headEventHash: 'c'.repeat(64),
    state: 'verified',
  },
  id: 'passport-id-with-entropy',
  merchantClaims: {
    description: 'Merchant says this headset uses repairable parts.',
    warrantySummary: 'Merchant says defects are covered for one year.',
  },
  overallState: 'verified',
  ownership: { maskedCurrentOwner: 'NQ34BU••••••111111', state: 'verified' },
  product: {
    imageUrl: '/demo-product.svg',
    issuerAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
    payloadHash: 'a'.repeat(64),
    state: 'verified',
    title: 'NimTrace Headphones',
    version: 1,
  },
  publicUrl: 'https://nimtrace.example/passports/passport-id-with-entropy',
  purchase: {
    blockHeight: 123456,
    confirmedAt: '2026-09-14T12:00:00.000Z',
    reason: 'verified_final',
    state: 'verified',
    transactionHash: 'b'.repeat(64),
  },
  status: 'active',
  warranty: {
    daysRemaining: 364,
    expiresAt: '2027-09-14T12:00:00.000Z',
    startedAt: '2026-09-14T12:00:00.000Z',
    state: 'active',
  },
} as const

describe('PublicPassportVerification', () => {
  afterEach(() => vi.clearAllMocks())

  it('checks every proof without wallet credentials and creates a secret-free QR', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(passport)))
    render(<PublicPassportVerification passportId={passport.id} fetcher={fetcher} />)

    expect(await screen.findByRole('heading', { name: 'NimTrace Headphones' })).toBeInTheDocument()
    expect(screen.getByText('Verified passport')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cryptographic facts' })).toBeInTheDocument()
    expect(screen.getByText(passport.ownership.maskedCurrentOwner)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Merchant claims' })).toBeInTheDocument()
    expect(screen.getByText(/NOT INDEPENDENTLY VERIFIED/)).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /Shareable public passport verification QR/i })).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(`/api/passports/${passport.id}/verification`, {
      signal: expect.any(AbortSignal),
    })
    expect(QRCode.toDataURL).toHaveBeenCalledWith(passport.publicUrl, expect.any(Object))
  })

  it.each([
    ['verified', 'Verified passport'],
    ['partially_verified', 'Partially verified'],
    ['unverified', 'Verification failed'],
    ['merchant_claim', 'Merchant claim only'],
  ] as const)('renders the honest %s verdict', async (overallState, label) => {
    const evidenceState = overallState === 'partially_verified' ? 'partial' : overallState === 'unverified' ? 'unverified' : overallState === 'merchant_claim' ? 'claim' : 'verified'
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...passport,
      eventChain: { ...passport.eventChain, state: evidenceState },
      overallState,
      ownership: { ...passport.ownership, state: evidenceState },
      product: { ...passport.product, state: evidenceState },
      purchase: { ...passport.purchase, reason: evidenceState === 'partial' ? 'provider_unavailable' : 'verified_final', state: evidenceState },
    })))
    render(<PublicPassportVerification passportId={passport.id} fetcher={fetcher} />)
    expect(await screen.findByText(label)).toBeInTheDocument()
    if (overallState === 'partially_verified') {
      expect(screen.getByText(/Last attempted/)).toBeInTheDocument()
    }
  })
})
