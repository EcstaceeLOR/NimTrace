import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MiniAppTabs } from './MiniAppTabs'

describe('MiniAppTabs', () => {
  it('keeps mobile primary navigation to four destinations', () => {
    render(<MiniAppTabs />)

    expect(screen.getByRole('navigation', { name: 'Mini App navigation' }).querySelectorAll('a')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/catalogue')
    expect(screen.getByRole('link', { name: 'Verify' })).toHaveAttribute('href', '/verify')
    expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute('href', '/wallet')
  })

  it('keeps issuer and merchant destinations available through quick actions', () => {
    render(<MiniAppTabs />)

    fireEvent.click(screen.getByRole('button', { name: 'Create and manage' }))
    expect(screen.getByRole('link', { name: 'Issue a product' })).toHaveAttribute('href', '/issue')
    expect(screen.getByRole('link', { name: 'Merchant Studio' })).toHaveAttribute('href', '/merchant')
    expect(screen.getByRole('button', { name: 'Create and manage' })).toHaveAttribute('aria-expanded', 'true')
  })
})
