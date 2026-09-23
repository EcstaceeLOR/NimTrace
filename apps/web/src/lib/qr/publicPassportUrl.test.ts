import { describe, expect, it } from 'vitest'
import { safePublicPassportQrUrl } from './publicPassportUrl'

describe('safePublicPassportQrUrl', () => {
  it('accepts the trusted production passport origin', () => {
    expect(safePublicPassportQrUrl('https://nimtrace.vercel.app/passports/passport-123'))
      .toBe('https://nimtrace.vercel.app/passports/passport-123')
  })

  it('allows localhost only in the development test environment', () => {
    expect(safePublicPassportQrUrl('http://127.0.0.1:5173/passports/passport-123'))
      .toBe('http://127.0.0.1:5173/passports/passport-123')
  })

  it.each([
    ['untrusted host', 'https://example.com/passports/passport-123'],
    ['insecure production protocol', 'http://nimtrace.vercel.app/passports/passport-123'],
    ['credentials', 'https://user:pass@nimtrace.vercel.app/passports/passport-123'],
    ['query parameters', 'https://nimtrace.vercel.app/passports/passport-123?token=secret'],
    ['fragment', 'https://nimtrace.vercel.app/passports/passport-123#details'],
    ['wrong path', 'https://nimtrace.vercel.app/products/product-123'],
  ])('rejects %s', (_label, value) => {
    expect(() => safePublicPassportQrUrl(value)).toThrow('Unsafe public passport URL')
  })
})
