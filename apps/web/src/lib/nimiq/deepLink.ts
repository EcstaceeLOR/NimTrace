import { WalletAdapterError } from './errors'

export function createNimiqPayDeepLink(targetUrl: string): string {
  let target: URL

  try {
    target = new URL(targetUrl)
  } catch {
    throw new WalletAdapterError('INVALID_REQUEST', 'The Mini App URL is invalid.')
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new WalletAdapterError('INVALID_REQUEST', 'The Mini App URL must use HTTP or HTTPS.')
  }

  // Nimiq Pay supports a custom URI too, but the HTTPS form is the right
  // hand-off for a public website: it works from browsers, messages, QR codes,
  // and devices where a custom URI has no registered handler.
  return `https://nimpay.app/miniapps/open/${encodeURIComponent(target.host)}`
}
