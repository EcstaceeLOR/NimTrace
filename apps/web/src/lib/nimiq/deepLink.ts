import { WalletAdapterError } from './errors'

function parseMiniAppUrl(targetUrl: string): URL {
  let target: URL

  try {
    target = new URL(targetUrl)
  } catch {
    throw new WalletAdapterError('INVALID_REQUEST', 'The Mini App URL is invalid.')
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new WalletAdapterError('INVALID_REQUEST', 'The Mini App URL must use HTTP or HTTPS.')
  }

  return target
}

// The custom URI retains the complete path and query. It is used when a buyer
// must return to a particular product or a recipient must return to a transfer.
export function createNimiqPayDeepLink(targetUrl: string): string {
  const target = parseMiniAppUrl(targetUrl)
  return `nimiqpay://miniapp?url=${encodeURIComponent(target.href)}`
}

// The HTTPS entry is the shareable public landing link. It works from browsers,
// messages, and QR codes where a custom URI has no registered handler.
export function createNimiqPayHttpsLink(targetUrl: string): string {
  const target = parseMiniAppUrl(targetUrl)
  return `https://nimpay.app/miniapps/open/${encodeURIComponent(target.host)}`
}
