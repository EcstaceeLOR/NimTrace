const TRUSTED_PRODUCTION_ORIGINS = new Set([
  'https://nimtrace.vercel.app',
])

function isLocalDevelopmentOrigin(url: URL) {
  if (!import.meta.env.DEV) return false
  return (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    && (url.protocol === 'http:' || url.protocol === 'https:')
}

export function safePublicPassportQrUrl(value: string) {
  const url = new URL(value)
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const currentProductionOrigin = currentOrigin.startsWith('https://') && TRUSTED_PRODUCTION_ORIGINS.has(currentOrigin)
    ? currentOrigin
    : ''
  const trustedProduction = url.protocol === 'https:'
    && (TRUSTED_PRODUCTION_ORIGINS.has(url.origin) || url.origin === currentProductionOrigin)

  if (
    (!trustedProduction && !isLocalDevelopmentOrigin(url))
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/passports\/[^/]+\/?$/.test(url.pathname)
  ) {
    throw new Error('Unsafe public passport URL')
  }

  return url.toString()
}
