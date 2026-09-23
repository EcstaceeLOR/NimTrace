import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransferAcceptance } from './TransferAcceptance'

const recipient = 'NQ22 BUYE 0000 0000 0000 0000 0000 0000 0000'
const owner = 'NQ11 SELL 0000 0000 0000 0000 0000 0000 0000'
const passportId = 'abcdefghijklmnopqrstuvwx'
const intentId = 'transfer-intent-123456789'
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

function transfer(priceLuna: number) {
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
  }
}

function fetcherFor(priceLuna: number) {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(transfer(priceLuna))))
    .mockResolvedValueOnce(new Response(JSON.stringify(passport)))
}

describe('TransferAcceptance price disclosure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('labels a zero-price transfer as a free gift before signature', async () => {
    render(<TransferAcceptance fetcher={fetcherFor(0)} intentId={intentId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review with Nimiq Pay' }))

    expect(await screen.findByText('Free gift')).toBeInTheDocument()
    expect(screen.getByText('No NIM payment')).toBeInTheDocument()
    expect(screen.getByText(/no NIM payment will be requested/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign acceptance' })).toBeInTheDocument()
  })

  it('shows paid resale price and sequence before signature', async () => {
    render(<TransferAcceptance fetcher={fetcherFor(100_000)} intentId={intentId} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review with Nimiq Pay' }))

    expect(await screen.findByText('Paid resale')).toBeInTheDocument()
    expect(screen.getByText(/direct .*NIM payment to the current owner/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign acceptance, then pay' })).toBeInTheDocument()
  })
})
