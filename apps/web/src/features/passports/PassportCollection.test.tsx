import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PassportDetail, PassportSummary } from '@nimtrace/contracts'
import { describe, expect, it, vi } from 'vitest'
import { PassportCollection } from './PassportCollection'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') } }))

const address = 'NQ22 BUYE 0000 0000 0000 0000 0000 0000 0000'
const hash = (character: string) => character.repeat(64)
const id = 'abcdefghijklmnopqrstuvwx'

const summary: PassportSummary = {
  auditState: 'verified',
  currentOwnerAddress: address,
  id,
  imageUrl: '/demo-product.svg',
  issuedAt: new Date().toISOString(),
  issuerAddress: 'NQ11 SELL 0000 0000 0000 0000 0000 0000 0000',
  ownership: 'current',
  productId: 'product-id-with-enough-entropy',
  productTitle: 'NimTrace Headphones',
  productVersion: 1,
  recentlyIssued: true,
  status: 'active',
  warrantyDaysRemaining: 365,
  warrantyExpiresAt: '2099-09-15T12:00:00.000Z',
  warrantyState: 'active',
}

const detail: PassportDetail = {
  ...summary,
  description: 'Repairable wireless headphones.',
  events: [{
    actorAddress: summary.issuerAddress,
    createdAt: summary.issuedAt,
    eventHash: hash('e'),
    previousEventHash: null,
    sequence: 1,
    type: 'issued',
  }],
  headEventHash: hash('e'),
  ownerActions: ['transfer', 'present_warranty'],
  productProofHash: hash('c'),
  publicUrl: `https://nimtrace.example/passports/${id}`,
  purchaseBlockHeight: 123456,
  purchaseConfirmedAt: '2026-09-15T12:00:00.000Z',
  purchaseIntentId: 'zyxwvutsrqponmlkjihgfedc',
  purchaseTransactionHash: hash('a'),
  warrantyStartedAt: '2026-09-15T12:00:00.000Z',
  warrantySummary: 'Manufacturing defects are covered for one year.',
}

describe('PassportCollection', () => {
  it('shows verified ownership and opens the complete durable passport', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [summary] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(detail)))
    render(<PassportCollection address={address} fetcher={fetcher} onBack={vi.fn()} sessionToken="secret-session" />)

    expect(await screen.findByText('NimTrace Headphones')).toBeInTheDocument()
    expect(screen.getByText('Added to your wallet')).toBeInTheDocument()
    expect(screen.getByText('365 days remaining')).toBeInTheDocument()
    expect(screen.getByText('✓ Verified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open passport' }))

    expect(await screen.findByRole('heading', { name: 'Product history' })).toBeInTheDocument()
    expect(screen.getByText(/payment-backed chain/i)).toBeInTheDocument()
    expect(screen.getByText('123456')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transfer passport' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Present warranty' })).toBeInTheDocument()
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/passports', expect.objectContaining({
      headers: { Authorization: 'Bearer secret-session' },
    }))
  }, 15_000)

  it('renders a polished empty collection without fabricating ownership', async () => {
    render(<PassportCollection
      address={address}
      fetcher={vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })))}
      onBack={vi.fn()}
      sessionToken="secret-session"
    />)
    expect(await screen.findByRole('heading', { name: 'Your first passport will appear here' })).toBeInTheDocument()
    expect(screen.getByText(/only after an independently verified NIM purchase/i)).toBeInTheDocument()
  })

  it('keeps former ownership read-only and visibly handles degraded suspended proof', async () => {
    const former: PassportSummary = {
      ...summary,
      auditState: 'degraded',
      ownership: 'former',
      status: 'suspended',
    }
    const formerDetail: PassportDetail = { ...detail, ...former, ownerActions: [] }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [former] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(formerDetail)))
    render(<PassportCollection address={address} fetcher={fetcher} onBack={vi.fn()} sessionToken="secret-session" />)
    await screen.findByRole('heading', { name: 'Your first passport will appear here' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include former ownership' }))
    expect(await screen.findByText('Formerly owned')).toBeInTheDocument()
    expect(screen.getByText('Check delayed')).toBeInTheDocument()
    expect(screen.getByText(/passport is suspended/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open passport' }))

    expect(await screen.findByText(/historical read-only view/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transfer passport' })).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/passports?includeHistory=true', expect.anything())
  })

  it('shows an honest recoverable error state', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    render(<PassportCollection address={address} fetcher={fetcher} onBack={vi.fn()} sessionToken="secret-session" />)
    expect(await screen.findByRole('heading', { name: 'Collection unavailable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })
})
