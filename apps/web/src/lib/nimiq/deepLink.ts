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

  return `nimiqpay://miniapp?url=${encodeURIComponent(target.href)}`
}
