import { afterEach, describe, expect, it } from 'vitest'
import { applyAppLanguage, getAppLanguage } from './i18n'

const originalPay = window.nimiqPay

afterEach(() => {
  window.nimiqPay = originalPay
  document.documentElement.lang = 'en'
  document.documentElement.dir = 'ltr'
})

describe('Mini App locale handling', () => {
  it('uses the supported Mini App language and strips the region', () => {
    window.nimiqPay = { language: 'de-DE' } as typeof window.nimiqPay
    expect(getAppLanguage()).toBe('de')
    expect(applyAppLanguage()).toBe('de')
    expect(document.documentElement.lang).toBe('de')
  })

  it('falls back to English for missing or unsupported languages', () => {
    window.nimiqPay = { language: 'xx-YY' } as typeof window.nimiqPay
    expect(getAppLanguage()).toBe('en')
    expect(applyAppLanguage()).toBe('en')
  })
})
