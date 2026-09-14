import type {
  AuthErrorResponse,
  NimiqNetwork,
  WalletChallengeResponse,
  WalletSessionRequest,
  WalletSessionResponse,
} from '@nimtrace/contracts'
import { normalizeNimiqAddress, randomToken, sha256Hex, verifyWalletSignature } from './crypto'
import { buildAuthenticationMessage } from './message'
import { findChallenge, insertChallenge, insertSession } from './repository'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type AuthErrorCode = AuthErrorResponse['error']

export class AuthServiceError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 410 | 500,
    readonly recoverable: boolean,
  ) {
    super(message)
  }
}

function fail(
  code: AuthErrorCode,
  message: string,
  status: AuthServiceError['status'],
  recoverable = true,
): never {
  throw new AuthServiceError(code, message, status, recoverable)
}

function canonicalAddress(walletAddress: string): string {
  try {
    return normalizeNimiqAddress(walletAddress)
  } catch {
    return fail('invalid_address', 'Enter a valid Nimiq wallet address.', 400)
  }
}

export async function issueWalletChallenge(
  db: D1Database,
  walletAddress: string,
  network: NimiqNetwork,
  now = new Date(),
): Promise<WalletChallengeResponse> {
  const address = canonicalAddress(walletAddress)
  const challengeId = randomToken(24)
  const issuedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString()
  const message = buildAuthenticationMessage({
    expiresAt,
    issuedAt,
    network,
    nonce: challengeId,
    walletAddress: address,
  })

  await insertChallenge(db, {
    challenge_hash: await sha256Hex(message),
    consumed_at: null,
    created_at: issuedAt,
    expires_at: expiresAt,
    id: challengeId,
    wallet_address: address,
  })

  return { challengeId, walletAddress: address, network, issuedAt, expiresAt, message }
}

export async function createWalletSession(
  db: D1Database,
  request: WalletSessionRequest,
  expectedNetwork: NimiqNetwork,
  now = new Date(),
): Promise<WalletSessionResponse> {
  if (request.network !== expectedNetwork) {
    fail('network_mismatch', 'This sign-in request belongs to a different Nimiq network.', 400)
  }

  const challenge = await findChallenge(db, request.challengeId)
  if (!challenge) fail('invalid_challenge', 'This sign-in request was not found.', 404)
  if (challenge.consumed_at) fail('challenge_consumed', 'This sign-in request was already used.', 409)
  if (Date.parse(challenge.expires_at) <= now.getTime()) {
    fail('challenge_expired', 'This sign-in request expired. Please try again.', 410)
  }

  const requestedAddress = canonicalAddress(request.walletAddress)
  if (requestedAddress !== challenge.wallet_address) {
    fail('wallet_address_mismatch', 'The selected wallet does not match this sign-in request.', 401)
  }

  const message = buildAuthenticationMessage({
    expiresAt: challenge.expires_at,
    issuedAt: challenge.created_at,
    network: expectedNetwork,
    nonce: challenge.id,
    walletAddress: challenge.wallet_address,
  })
  if (await sha256Hex(message) !== challenge.challenge_hash) {
    fail('invalid_challenge', 'This sign-in request could not be verified.', 400, false)
  }

  const verification = await verifyWalletSignature(message, request.publicKey, request.signature)
  if (!verification?.valid) fail('invalid_signature', 'The wallet signature is invalid.', 401)
  if (verification.address !== challenge.wallet_address) {
    fail('wallet_address_mismatch', 'The signature belongs to a different wallet.', 401)
  }

  const sessionToken = randomToken(32)
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()

  try {
    await insertSession(db, {
      challengeId: challenge.id,
      createdAt,
      expiresAt,
      id: randomToken(24),
      tokenHash: await sha256Hex(sessionToken),
      walletAddress: challenge.wallet_address,
    })
  } catch (error) {
    if (error instanceof Error && /challenge_unavailable|UNIQUE constraint/i.test(error.message)) {
      fail('challenge_consumed', 'This sign-in request was already used or expired.', 409)
    }
    throw error
  }

  return { sessionToken, walletAddress: challenge.wallet_address, expiresAt }
}
