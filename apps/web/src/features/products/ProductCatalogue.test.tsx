import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductCatalogue } from './ProductCatalogue'

const baseProduct = {
  currentVersion: 1,
  description: 'Repairable wireless headphones.',
  imageUrl: '/demo-product.svg',
  issuedAt: '2026-09-14T12:00:00.000Z',
  issuerAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
  priceLuna: 100000,
  proofHash: 'a'.repeat(64),
  serialFingerprint: 'b'.repeat(12),
  signatureState: 'verified' as const,
  version: 1,
  warrantyDurationDays: 730,
  warrantySummary: 'Manufacturing defects are covered for two years.',
}

const products = [
  { ...baseProduct, id: 'available-product', state: 'available' as const, title: 'Available Headphones' },
  { ...baseProduct, id: 'checked-out-product', state: 'checked_out' as const, title: 'Reserved Headphones' },
  { ...baseProduct, id: 'completed-product', state: 'owned' as const, title: 'Completed Headphones' },
]

describe('ProductCatalogue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps available products separate from active checkout and completed products', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: products })))
    vi.stubGlobal('fetch', fetcher)

    const { unmount } = render(<ProductCatalogue />)

    expect(await screen.findByText('Available Headphones')).toBeInTheDocument()
    expect(screen.queryByText('Reserved Headphones')).not.toBeInTheDocument()
    expect(screen.queryByText('Completed Headphones')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Available1/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Checkout in progress1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Completed1/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Checkout in progress1/i }))
    expect(screen.getByText('Reserved Headphones')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View checkout in progress' })).toHaveAttribute('href', '/products/checked-out-product')
    expect(screen.queryByText('Available Headphones')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View listing and buy' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Completed1/i }))
    expect(screen.getByText('Completed Headphones')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View completed sale' })).toHaveAttribute('href', '/products/completed-product')
    expect(screen.queryByText('Available Headphones')).not.toBeInTheDocument()
    expect(screen.queryByText('Reserved Headphones')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View listing and buy' })).not.toBeInTheDocument()

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/products\?live=\d+$/),
      expect.objectContaining({ cache: 'no-store' }),
    )
    unmount()
  })
})
