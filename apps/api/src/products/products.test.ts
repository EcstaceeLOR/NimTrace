import { readFileSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { KeyPair } from '@nimiq/core'
import {
  ProductIssuanceChallengeResponseSchema,
  PublishedProductResponseSchema,
} from '@nimtrace/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../index'
import { sha256Hex } from '../auth/crypto'
import { nimiqSignedMessageDigest } from '../auth/message'

const migrations = [
  '0001_lifecycle_schema.sql',
  '0002_wallet_auth_invariants.sql',
  '0003_product_issuance.sql',
].map((name) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')).join('\n')

class TestStatement {
  #statement: StatementSync
  #values: string[] = []

  constructor(statement: StatementSync) {
    this.#statement = statement
  }

  bind(...values: unknown[]) {
    this.#values = values as string[]
    return this
  }

  async first<T>(column?: string) {
    const row = this.#statement.get(...this.#values) as Record<string, unknown> | undefined
    return (column ? row?.[column] : row) as T | null
  }

  async run() {
    const result = this.#statement.run(...this.#values)
    return { success: true, meta: { changes: Number(result.changes) }, results: [] }
  }
}

function databasePort(database: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return new TestStatement(database.prepare(query))
    },
    async batch(statements: TestStatement[]) {
      database.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
}

describe('merchant product issuance API', () => {
  let database: DatabaseSync
  let db: D1Database
  let keyPair: KeyPair
  let walletAddress: string
  const token = 'merchant-session-token-with-enough-entropy-12345'

  beforeEach(async () => {
    database = new DatabaseSync(':memory:')
    database.exec(migrations)
    db = databasePort(database)
    keyPair = KeyPair.generate()
    const address = keyPair.toAddress()
    try {
      walletAddress = address.toUserFriendlyAddress()
    } finally {
      address.free()
    }
    database.prepare(`
      INSERT INTO wallet_challenges (
        id, wallet_address, challenge_hash, expires_at, created_at
      ) VALUES (?, ?, ?, '2099-01-01T00:05:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run('product-test-auth-challenge', walletAddress, 'a'.repeat(64))
    database.prepare(`
      INSERT INTO wallet_sessions (
        id, wallet_address, challenge_id, token_hash, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, '2099-01-02T00:00:00.000Z', ?, ?)
    `).run(
      'product-test-session', walletAddress, 'product-test-auth-challenge', await sha256Hex(token),
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
    )
  })

  afterEach(() => {
    keyPair.free()
    database.close()
  })

  async function requestChallenge() {
    const response = await app.request('/api/products/issuance-challenges', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Wireless headphones built for repairability.',
        imageHash: 'b'.repeat(64),
        imageKey: 'pending/b'.concat('b'.repeat(63)),
        priceLuna: 100000,
        serialReference: 'DEMO-HEADPHONES-001',
        title: 'NimTrace Headphones',
        warrantyDurationDays: 730,
        warrantySummary: 'Covers manufacturing defects for two years.',
      }),
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })
    expect(response.status).toBe(201)
    return ProductIssuanceChallengeResponseSchema.parse(await response.json())
  }

  async function sign(challenge: Awaited<ReturnType<typeof requestChallenge>>, signer = keyPair) {
    const signature = signer.sign(await nimiqSignedMessageDigest(challenge.message))
    try {
      return signature.toHex()
    } finally {
      signature.free()
    }
  }

  function publicKey(signer = keyPair) {
    return signer.publicKey.toHex()
  }

  async function publish(challenge: Awaited<ReturnType<typeof requestChallenge>>, signer = keyPair) {
    return app.request('/api/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: {
          envelope: challenge.envelope,
          payload: challenge.payload,
          publicKey: publicKey(signer),
          signature: await sign(challenge, signer),
        },
      }),
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })
  }

  it('publishes an immutable signed first version and consumes the nonce', async () => {
    const challenge = await requestChallenge()
    expect(challenge.message).toContain('Issue “NimTrace Headphones”')
    expect(challenge.payload.priceLuna).toBe(100000)

    const response = await publish(challenge)
    expect(response.status).toBe(201)
    expect(PublishedProductResponseSchema.parse(await response.json())).toEqual({
      id: challenge.payload.productId,
      status: 'published',
      version: 1,
    })

    const stored = database.prepare(`
      SELECT products.issuer_address, products.price_luna, products.current_version,
             product_versions.issuer_signature, proof_nonces.consumed_at
      FROM products
      JOIN product_versions ON product_versions.product_id = products.id
      JOIN proof_nonces ON proof_nonces.id = product_versions.proof_nonce
      WHERE products.id = ?
    `).get(challenge.payload.productId) as Record<string, unknown>
    expect(stored).toMatchObject({
      issuer_address: walletAddress,
      price_luna: 100000,
      current_version: 1,
    })
    expect(stored.issuer_signature).toBeTruthy()
    expect(stored.consumed_at).toBeTruthy()

    expect(() => database.prepare(`
      UPDATE product_versions SET canonical_payload = '{}' WHERE product_id = ? AND version = 1
    `).run(challenge.payload.productId)).toThrow(/product_versions_are_immutable/)
  })

  it('rejects nonce replay', async () => {
    const challenge = await requestChallenge()
    expect((await publish(challenge)).status).toBe(201)
    expect((await publish(challenge)).status).toBe(409)
  })

  it('rejects a signature from a wallet other than the authenticated issuer', async () => {
    const challenge = await requestChallenge()
    const other = KeyPair.generate()
    try {
      const response = await publish(challenge, other)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: 'invalid_product_proof:signer_address_mismatch',
      })
    } finally {
      other.free()
    }
  })

  it('requires an active wallet session', async () => {
    const response = await app.request('/api/products/issuance-challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }, { DB: db, NIMIQ_NETWORK: 'main-albatross' })
    expect(response.status).toBe(401)
  })
})
