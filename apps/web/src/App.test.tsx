import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.nimiq
    delete window.nimiqPay
  })

  it('renders the product-passport proposition and reports API readiness', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'ok',
      service: 'nimtrace-api',
      version: '0.1.0',
      environment: 'test',
      timestamp: new Date().toISOString(),
    }))))

    render(<App />)

    expect(screen.getByRole('heading', { name: /every product deserves proof that lasts/i })).toBeInTheDocument()
    expect(await screen.findByText('Network ready')).toBeInTheDocument()
  })

  it('keeps the public page usable and offers a Nimiq Pay deep link outside the host', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'ok',
      service: 'nimtrace-api',
      version: '0.1.0',
      environment: 'test',
      timestamp: new Date().toISOString(),
    }))))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /view my passports/i }))

    const fallback = await screen.findByRole('link', { name: /open nimtrace in nimiq pay/i })
    expect(fallback).toHaveAttribute('href', expect.stringMatching(/^nimiqpay:\/\/miniapp\?url=/))
    expect(screen.getByRole('heading', { name: /every product deserves proof that lasts/i })).toBeInTheDocument()
  })
})
