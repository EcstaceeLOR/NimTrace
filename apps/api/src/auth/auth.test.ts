import { readFileSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { KeyPair } from '@nimiq/core'
import {
  AuthErrorResponseSchema,
  WalletChallengeResponseSchema,
  WalletSessionResponseSchema,
} from '@nimtrace/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../index'
import { nimiqSignedMessageDigest } from './message'

const migrations = [
  '0001_lifecycle_schema.sql',
  '0002_wallet_auth_invariants.sql',
  '0003_product_issuance.sql',
].map((name) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')).join('\n')

class TestD1Statement {
  #statement: StatementSync
  #values: string[] = []

  constructor(statement: StatementSync) {
    this.#statement = statement
  }

  bind(...values: unknown[]) {
    this.#values = values as string[]
    return this
  }

  async first<T>() {
    return (this.#statement.get(...this.#values) as T | undefined) ?? null
  }

  async run() {
    const result = this.#statement.run(...this.#values)
    return {
      success: true,
      meta: { changes: Number(result.changes) },
      results: [],
    }
  }
}

function asD1(database: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return new TestD1Statement(database.prepare(query))
    },
  } as unknown as D1Database
}

function keyIdentity(keyPair: KeyPair) {
  const address = keyPair.toAddress()
  try {
    return {
      address: address.toUserFriendlyAddress(),
      publicKey: keyPair.publicKey.toHex(),
    }
  } finally {
    address.free()
  }
}

async function signChallenge(keyPair: KeyPair, message: string) {
  const signature = keyPair.sign(await nimiqSignedMessageDigest(message))
  try {
    return signature.toHex()
  } finally {
    signature.free()
  }
}

describe('wallet challenge authentication API', () => {
  let database: DatabaseSync
  let db: D1Database
  const keyPairs: KeyPair[] = []

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(migrations)
    db = asD1(database)
  })

  afterEach(() => {
    for (const keyPair of keyPairs.splice(0)) keyPair.free()
    database.close()
  })

  function createKeyPair() {
    const keyPair = KeyPair.generate()
    keyPairs.push(keyPair)
    return keyPair
  }

  async function issueChallenge(walletAddress: string) {
    const response = await app.request('/api/auth/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })

    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    return WalletChallengeResponseSchema.parse(await response.json())
  }

  async function submitChallenge(
    challenge: Awaited<ReturnType<typeof issueChallenge>>,
    keyPair: KeyPair,
    walletAddress = challenge.walletAddress,
  ) {
    return app.request('/api/auth/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        network: challenge.network,
        publicKey: keyIdentity(keyPair).publicKey,
        signature: await signChallenge(keyPair, challenge.message),
        walletAddress,
      }),
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })
  }

  it('creates a session, stores only its token hash, and consumes the challenge', async () => {
    const keyPair = createKeyPair()
    const identity = keyIdentity(keyPair)
    const challenge = await issueChallenge(identity.address)
    expect(challenge.message).toContain('This request cannot send NIM')
    expect(challenge.message).toContain(`Wallet: ${identity.address}`)

    const response = await submitChallenge(challenge, keyPair)
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const session = WalletSessionResponseSchema.parse(await response.json())

    const stored = database.prepare(`
      SELECT token_hash, consumed_at
      FROM wallet_sessions
      JOIN wallet_challenges ON wallet_challenges.id = wallet_sessions.challenge_id
      WHERE wallet_sessions.challenge_id = ?
    `).get(challenge.challengeId) as { consumed_at: string; token_hash: string }
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.token_hash).not.toBe(session.sessionToken)
    expect(stored.consumed_at).not.toBeNull()
  })

  it('issues random challenges that expire after five minutes', async () => {
    const keyPair = createKeyPair()
    const walletAddress = keyIdentity(keyPair).address
    const first = await issueChallenge(walletAddress)
    const second = await issueChallenge(walletAddress)

    expect(first.challengeId).not.toBe(second.challengeId)
    expect(Date.parse(first.expiresAt) - Date.parse(first.issuedAt)).toBe(5 * 60 * 1000)
  })

  it('rejects replay of a consumed challenge', async () => {
    const keyPair = createKeyPair()
    const challenge = await issueChallenge(keyIdentity(keyPair).address)

    expect((await submitChallenge(challenge, keyPair)).status).toBe(201)
    const replay = await submitChallenge(challenge, keyPair)
    expect(replay.status).toBe(409)
    expect(AuthErrorResponseSchema.parse(await replay.json()).error).toBe('challenge_consumed')
  })

  it('rejects a signature made by a different wallet', async () => {
    const requestedKey = createKeyPair()
    const signingKey = createKeyPair()
    const challenge = await issueChallenge(keyIdentity(requestedKey).address)

    const response = await submitChallenge(challenge, signingKey)
    expect(response.status).toBe(401)
    expect(AuthErrorResponseSchema.parse(await response.json()).error).toBe('wallet_address_mismatch')
  })

  it('rejects a response for a different Nimiq network', async () => {
    const keyPair = createKeyPair()
    const identity = keyIdentity(keyPair)
    const challenge = await issueChallenge(identity.address)
    const response = await app.request('/api/auth/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        network: 'test-albatross',
        publicKey: identity.publicKey,
        signature: await signChallenge(keyPair, challenge.message),
        walletAddress: identity.address,
      }),
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })

    expect(response.status).toBe(400)
    expect(AuthErrorResponseSchema.parse(await response.json()).error).toBe('network_mismatch')
  })

  it('returns a recoverable error for an expired challenge', async () => {
    const keyPair = createKeyPair()
    const challenge = await issueChallenge(keyIdentity(keyPair).address)
    database.prepare(`
      UPDATE wallet_challenges
      SET created_at = '1999-01-01T00:00:00.000Z', expires_at = '2000-01-01T00:00:00.000Z'
      WHERE id = ?
    `).run(challenge.challengeId)

    const response = await submitChallenge(challenge, keyPair)
    expect(response.status).toBe(410)
    expect(AuthErrorResponseSchema.parse(await response.json())).toMatchObject({
      error: 'challenge_expired',
      recoverable: true,
    })
  })
})
