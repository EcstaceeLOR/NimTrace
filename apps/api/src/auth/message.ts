import type { NimiqNetwork } from '@nimtrace/contracts'

const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'

interface AuthenticationMessageInput {
  expiresAt: string
  issuedAt: string
  network: NimiqNetwork
  nonce: string
  walletAddress: string
}

export function buildAuthenticationMessage(input: AuthenticationMessageInput): string {
  return [
    'NimTrace wallet sign-in',
    '',
    'Authorize this wallet to access NimTrace.',
    'This request cannot send NIM or approve a transaction.',
    '',
    'Domain: nimtrace',
    'Version: 1',
    'Action: AUTHENTICATE',
    `Network: ${input.network}`,
    `Wallet: ${input.walletAddress}`,
    `Nonce: ${input.nonce}`,
    `Issued at: ${input.issuedAt}`,
    `Expires at: ${input.expiresAt}`,
  ].join('\n')
}

export async function nimiqSignedMessageDigest(message: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const messageBytes = encoder.encode(message)
  const payload = encoder.encode(`${SIGNED_MESSAGE_PREFIX}${messageBytes.byteLength}${message}`)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
}
