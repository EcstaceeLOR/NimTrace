const supported = new Set(['en', 'de', 'es', 'fr', 'pt', 'nl'])

/** Resolve the Mini App locale without ever blocking the product on a wallet. */
export function getAppLanguage(): string {
  if (typeof window === 'undefined') return 'en'
  const candidate = (window.nimiqPay as { language?: string } | undefined)?.language?.toLowerCase().split('-')[0]
  return candidate && supported.has(candidate) ? candidate : 'en'
}

export function applyAppLanguage(): string {
  const language = getAppLanguage()
  document.documentElement.lang = language
  document.documentElement.dir = 'ltr'
  return language
}
