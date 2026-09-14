import { sha256Hex } from './crypto'

export class SessionAuthenticationError extends Error {}

export async function authenticatedWallet(
  db: D1Database,
  authorization: string | undefined,
  now = new Date(),
): Promise<string> {
  const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(authorization ?? '')
  if (!match?.[1]) throw new SessionAuthenticationError('A valid wallet session is required.')

  const walletAddress = await db.prepare(`
    SELECT wallet_address
    FROM wallet_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).bind(await sha256Hex(match[1]), now.toISOString()).first<string>('wallet_address')

  if (!walletAddress) throw new SessionAuthenticationError('The wallet session expired or is invalid.')
  return walletAddress
}
