import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MerchantCommandCenter } from './MerchantCommandCenter'

const baseProduct = {
  issuedAt: '2026-09-20T10:00:00.000Z',
  passportId: null,
  passportStatus: null,
  priceLuna: 100000,
  purchaserMasked: null,
  warrantyDurationDays: 365,
  warrantySummary: 'One year warranty.',
} as const

const items = [
  { ...baseProduct, id: 'available-1', state: 'available', title: 'Available Headphones' },
  { ...baseProduct, id: 'owned-1', state: 'owned', title: 'Owned Camera', passportId: 'passport-owned', passportStatus: 'active', purchaserMasked: 'NQ12••••34' },
  { ...baseProduct, id: 'suspended-1', state: 'suspended', title: 'Suspended Watch', passportId: 'passport-suspended', passportStatus: 'suspended', purchaserMasked: 'NQ56••••78' },
  { ...baseProduct, id: 'retired-1', state: 'retired', title: 'Retired Speaker', passportId: 'passport-retired', passportStatus: 'retired', purchaserMasked: 'NQ90••••12' },
] as const

describe('MerchantCommandCenter lifecycle filters', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows every API lifecycle state with an accurate count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items })))
    render(<MerchantCommandCenter sessionToken="merchant-session-token" onBack={() => undefined} />)

    expect(await screen.findByRole('heading', { name: 'Available Headphones' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Available 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Owned 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspended 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retired 1' })).toBeInTheDocument()
  })

  it('composes lifecycle filtering with catalogue search', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ items })))
    render(<MerchantCommandCenter sessionToken="merchant-session-token" onBack={() => undefined} />)

    await screen.findByRole('heading', { name: 'Available Headphones' })
    fireEvent.click(screen.getByRole('button', { name: 'Suspended 1' }))

    expect(screen.getByRole('heading', { name: 'Suspended Watch' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Available Headphones' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search catalogue' }), { target: { value: 'camera' } })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No matching products' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Owned 1' }))
    expect(screen.getByRole('heading', { name: 'Owned Camera' })).toBeInTheDocument()
  })
})
