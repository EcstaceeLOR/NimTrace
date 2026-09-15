import { readFileSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { KeyPair } from '@nimiq/core'
import {
  ProductIssuanceChallengeResponseSchema,
  PaymentSubmissionResponseSchema,
  PaymentVerificationResponseSchema,
  PublishedProductResponseSchema,
  PurchaseIntentResponseSchema,
} from '@nimtrace/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../index'
import { sha256Hex } from '../auth/crypto'
import { nimiqSignedMessageDigest } from '../auth/message'
import { DEMO_IMAGE_HASH, DEMO_IMAGE_KEY } from '../images/service'
import {
  confirmPaymentIntent,
  expirePendingPurchaseIntents,
  failPaymentIntent,
  submitPaymentIntent,
} from './repository'
import { reconcilePaymentIntents, recordPaymentSubmission } from './service'

const migrations = [
  '0001_lifecycle_schema.sql',
  '0002_wallet_auth_invariants.sql',
  '0003_product_issuance.sql',
  '0004_purchase_intents.sql',
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

  async all<T>() {
    return {
      success: true,
      meta: {},
      results: this.#statement.all(...this.#values) as T[],
    }
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

function walletAddress(keyPair: KeyPair) {
  const address = keyPair.toAddress()
  try {
    return address.toUserFriendlyAddress()
  } finally {
    address.free()
  }
}

describe('buyer-bound purchase intents', () => {
  let database: DatabaseSync
  let db: D1Database
  let sellerKey: KeyPair
  let buyerKey: KeyPair
  let otherBuyerKey: KeyPair
  let sellerAddress: string
  let buyerAddress: string
  let otherBuyerAddress: string
  const sellerToken = 'seller-session-token-with-enough-entropy-12345'
  const buyerToken = 'buyer-session-token-with-enough-entropy-123456'
  const otherBuyerToken = 'other-buyer-session-token-with-enough-entropy'

  async function seedSession(address: string, token: string, suffix: string) {
    const createdAt = '2026-01-01T00:00:00.000Z'
    database.prepare(`
      INSERT INTO wallet_challenges (
        id, wallet_address, challenge_hash, expires_at, created_at
      ) VALUES (?, ?, ?, '2099-01-01T00:05:00.000Z', ?)
    `).run(`challenge-${suffix}`, address, suffix.repeat(64).slice(0, 64), createdAt)
    database.prepare(`
      INSERT INTO wallet_sessions (
        id, wallet_address, challenge_id, token_hash, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, '2099-01-02T00:00:00.000Z', ?, ?)
    `).run(
      `session-${suffix}`,
      address,
      `challenge-${suffix}`,
      await sha256Hex(token),
      createdAt,
      createdAt,
    )
  }

  beforeEach(async () => {
    database = new DatabaseSync(':memory:')
    database.exec(migrations)
    db = databasePort(database)
    sellerKey = KeyPair.generate()
    buyerKey = KeyPair.generate()
    otherBuyerKey = KeyPair.generate()
    sellerAddress = walletAddress(sellerKey)
    buyerAddress = walletAddress(buyerKey)
    otherBuyerAddress = walletAddress(otherBuyerKey)
    await seedSession(sellerAddress, sellerToken, 'a')
    await seedSession(buyerAddress, buyerToken, 'b')
    await seedSession(otherBuyerAddress, otherBuyerToken, 'c')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sellerKey.free()
    buyerKey.free()
    otherBuyerKey.free()
    database.close()
  })

  async function publishProduct(serial: string, priceLuna = 123456) {
    const challengeResponse = await app.request('/api/products/issuance-challenges', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'A signed product prepared for direct NIM checkout.',
        imageHash: DEMO_IMAGE_HASH,
        imageKey: DEMO_IMAGE_KEY,
        priceLuna,
        serialReference: serial,
        title: `NimTrace Product ${serial}`,
        warrantyDurationDays: 365,
        warrantySummary: 'Manufacturing defects are covered for one year.',
      }),
    }, { DB: db, NIMIQ_NETWORK: 'test-albatross' })
    expect(challengeResponse.status).toBe(201)
    const challenge = ProductIssuanceChallengeResponseSchema.parse(await challengeResponse.json())
    const signature = sellerKey.sign(await nimiqSignedMessageDigest(challenge.message))
    let signatureHex: string
    try {
      signatureHex = signature.toHex()
    } finally {
      signature.free()
    }

    const publishedResponse = await app.request('/api/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: {
          envelope: challenge.envelope,
          payload: challenge.payload,
          publicKey: sellerKey.publicKey.toHex(),
          signature: signatureHex,
        },
      }),
    }, { DB: db, NIMIQ_NETWORK: 'test-albatross' })
    expect(publishedResponse.status).toBe(201)
    return PublishedProductResponseSchema.parse(await publishedResponse.json()).id
  }

  function requestIntent(productId: string, key: string, token = buyerToken, body = '{}') {
    return app.request(`/api/products/${productId}/purchase-intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body,
    }, { DB: db, NIMIQ_NETWORK: 'test-albatross' })
  }

  function submitIntent(intentId: string, transactionHash: string, token = buyerToken) {
    return app.request(`/api/payment-intents/${intentId}/submissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionHash }),
    }, { DB: db, NIMIQ_NETWORK: 'test-albatross' })
  }

  it('derives and persists every payment value without client input', async () => {
    const productId = await publishProduct('BOUND-001')
    const response = await requestIntent(productId, 'purchase-attempt-0001')
    expect(response.status).toBe(201)
    const intent = PurchaseIntentResponseSchema.parse(await response.json())

    expect(intent).toMatchObject({
      amountLuna: 123456,
      buyerAddress,
      network: 'test-albatross',
      productId,
      productVersion: 1,
      sellerAddress,
      status: 'pending',
    })
    expect(intent.transactionData).toBe(`NTP1:${intent.id}`)
    expect(new TextEncoder().encode(intent.transactionData)).toHaveLength(29)

    const stored = database.prepare(`
      SELECT idempotency_key_hash, transaction_data FROM payment_intents WHERE id = ?
    `).get(intent.id) as { idempotency_key_hash: string; transaction_data: string }
    expect(stored.idempotency_key_hash).toBe(await sha256Hex('purchase-attempt-0001'))
    expect(stored.idempotency_key_hash).not.toContain('purchase-attempt')
    expect(stored.transaction_data).toBe(intent.transactionData)
  })

  it('replays an idempotent request and rejects client-selected payment values', async () => {
    const productId = await publishProduct('IDEMPOTENT-001')
    const first = await requestIntent(productId, 'purchase-attempt-0002')
    const firstIntent = PurchaseIntentResponseSchema.parse(await first.json())
    const replay = await requestIntent(productId, 'purchase-attempt-0002')

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(firstIntent)
    expect((database.prepare('SELECT COUNT(*) AS count FROM payment_intents').get() as { count: number }).count)
      .toBe(1)

    const override = await requestIntent(
      productId,
      'purchase-attempt-0003',
      buyerToken,
      JSON.stringify({ amountLuna: 1, sellerAddress: buyerAddress, transactionData: 'chosen' }),
    )
    expect(override.status).toBe(400)
    expect(await override.json()).toMatchObject({ error: 'invalid_purchase_intent' })

    const otherProductId = await publishProduct('IDEMPOTENT-002')
    const conflictingReplay = await requestIntent(otherProductId, 'purchase-attempt-0002')
    expect(conflictingReplay.status).toBe(409)
    expect(await conflictingReplay.json()).toMatchObject({ error: 'idempotency_conflict' })
  })

  it('expires unpaid work before safely creating a fresh intent', async () => {
    const productId = await publishProduct('EXPIRY-001')
    const first = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-0004')
    ).json())
    const afterExpiry = new Date(Date.parse(first.expiresAt) + 1).toISOString()
    await expirePendingPurchaseIntents(db, productId, afterExpiry)

    const replay = await requestIntent(productId, 'purchase-attempt-0004')
    expect(PurchaseIntentResponseSchema.parse(await replay.json()).status).toBe('expired')

    const recreated = await requestIntent(productId, 'purchase-attempt-0005')
    expect(recreated.status).toBe(201)
    expect(PurchaseIntentResponseSchema.parse(await recreated.json()).id).not.toBe(first.id)
  })

  it('allows only one buyer-bound active checkout for a physical product', async () => {
    const productId = await publishProduct('BUYER-LOCK-001')
    expect((await requestIntent(productId, 'purchase-attempt-0006')).status).toBe(201)

    const competing = await requestIntent(
      productId,
      'purchase-attempt-0007',
      otherBuyerToken,
    )
    expect(competing.status).toBe(409)
    expect(await competing.json()).toMatchObject({ error: 'product_checkout_busy' })
  })

  it('records the submitted hash idempotently without claiming payment confirmation', async () => {
    const productId = await publishProduct('SUBMISSION-001')
    const intent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-0011')
    ).json())
    const transactionHash = 'a'.repeat(64)

    const submitted = await submitIntent(intent.id, transactionHash)
    expect(submitted.status).toBe(200)
    expect(PaymentSubmissionResponseSchema.parse(await submitted.json())).toEqual({
      id: intent.id,
      status: 'submitted',
      transactionHash,
    })
    expect(PaymentSubmissionResponseSchema.parse(await (
      await submitIntent(intent.id, transactionHash)
    ).json()).status).toBe('submitted')

    const stored = database.prepare(`
      SELECT status, transaction_hash, confirmed_at, confirmed_block_height
      FROM payment_intents WHERE id = ?
    `).get(intent.id) as Record<string, unknown>
    expect(stored).toEqual({
      status: 'submitted',
      transaction_hash: transactionHash,
      confirmed_at: null,
      confirmed_block_height: null,
    })

    const conflicting = await submitIntent(intent.id, 'b'.repeat(64))
    expect(conflicting.status).toBe(409)
    expect(await conflicting.json()).toMatchObject({ error: 'transaction_hash_conflict' })

    const hidden = await submitIntent(intent.id, transactionHash, otherBuyerToken)
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toMatchObject({ error: 'payment_intent_not_found' })
  })

  it('confirms only after the authenticated verification endpoint matches independent chain data', async () => {
    const productId = await publishProduct('VERIFY-001', 7654321)
    const intent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-verify-0001')
    ).json())
    const transactionHash = 'd'.repeat(64)
    expect((await submitIntent(intent.id, transactionHash)).status).toBe(200)

    const chainTimestamp = Date.parse(intent.createdAt) + 1_000
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        data: {
          blockNumber: 123456,
          confirmations: 60,
          executionResult: true,
          from: buyerAddress,
          fromType: 0,
          hash: transactionHash,
          networkId: 5,
          recipientData: Buffer.from(intent.transactionData, 'utf8').toString('hex'),
          relatedAddresses: [buyerAddress, sellerAddress],
          timestamp: chainTimestamp,
          to: sellerAddress,
          toType: 0,
          value: intent.amountLuna,
        },
        metadata: null,
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)

    const verifiedResponse = await app.request(
      `/api/payment-intents/${intent.id}/verification`,
      { headers: { Authorization: `Bearer ${buyerToken}` } },
      {
        DB: db,
        NIMIQ_NETWORK: 'test-albatross',
        NIMIQ_RPC_FALLBACK_URL: '',
        NIMIQ_RPC_PRIMARY_URL: 'https://primary.example/rpc',
      },
    )
    expect(verifiedResponse.status).toBe(200)
    expect(PaymentVerificationResponseSchema.parse(await verifiedResponse.json())).toMatchObject({
      blockHeight: 123456,
      confirmations: 60,
      reason: 'verified_final',
      state: 'verified',
      transactionHash,
    })
    expect(database.prepare(`
      SELECT status, confirmed_block_height, confirmed_at FROM payment_intents WHERE id = ?
    `).get(intent.id)).toEqual({
      confirmed_at: new Date(chainTimestamp).toISOString(),
      confirmed_block_height: 123456,
      status: 'confirmed',
    })

    const replay = await app.request(
      `/api/payment-intents/${intent.id}/verification`,
      { headers: { Authorization: `Bearer ${buyerToken}` } },
      { DB: db, NIMIQ_NETWORK: 'test-albatross' },
    )
    expect(PaymentVerificationResponseSchema.parse(await replay.json()).state).toBe('verified')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('recovers a force-closed payment from its unique chain tag and uses the normal settlement path', async () => {
    const productId = await publishProduct('RECOVER-TAG-001', 2345678)
    const intent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-recover-0001')
    ).json())
    const transactionHash = 'e'.repeat(64)
    const timestamp = Date.parse(intent.createdAt) + 2_000
    const transaction = {
      blockNumber: 456789,
      confirmations: 60,
      executionResult: true,
      from: buyerAddress,
      fromType: 0,
      hash: transactionHash,
      networkId: 5,
      recipientData: Buffer.from(intent.transactionData).toString('hex'),
      relatedAddresses: [buyerAddress, sellerAddress],
      timestamp,
      to: sellerAddress,
      toType: 0,
      value: intent.amountLuna,
    }
    const rpc = {
      getTransaction: vi.fn(),
      getTransactionsByAddress: vi.fn().mockResolvedValue({ status: 'found', transactions: [transaction] }),
    }

    await expect(reconcilePaymentIntents(
      db,
      'test-albatross',
      rpc,
      new Date(timestamp + 60_000),
    )).resolves.toEqual({ checked: 1, inconclusive: 0, pending: 0, rejected: 0, verified: 1 })
    expect(database.prepare(`
      SELECT status, transaction_hash, confirmed_block_height, confirmed_at
      FROM payment_intents WHERE id = ?
    `).get(intent.id)).toEqual({
      confirmed_at: new Date(timestamp).toISOString(),
      confirmed_block_height: 456789,
      status: 'confirmed',
      transaction_hash: transactionHash,
    })
    expect(rpc.getTransaction).not.toHaveBeenCalled()
  })

  it('binds a discovered pre-final transaction once and polls the same hash idempotently', async () => {
    const productId = await publishProduct('RECOVER-PENDING-001')
    const intent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-recover-0002')
    ).json())
    const transactionHash = 'f'.repeat(64)
    const transaction = {
      blockNumber: 567890,
      confirmations: 20,
      executionResult: true,
      from: buyerAddress,
      hash: transactionHash,
      networkId: 5,
      recipientData: Buffer.from(intent.transactionData).toString('hex'),
      relatedAddresses: [buyerAddress, sellerAddress],
      timestamp: Date.parse(intent.createdAt) + 1_000,
      to: sellerAddress,
      value: intent.amountLuna,
    }
    const rpc = {
      getTransaction: vi.fn().mockResolvedValue({
        status: 'found',
        transaction: { ...transaction, confirmations: 60 },
      }),
      getTransactionsByAddress: vi.fn().mockResolvedValue({ status: 'found', transactions: [transaction] }),
    }

    const first = await reconcilePaymentIntents(db, 'test-albatross', rpc)
    expect(first).toMatchObject({ pending: 1, verified: 0 })
    expect(database.prepare('SELECT status, transaction_hash FROM payment_intents WHERE id = ?').get(intent.id))
      .toEqual({ status: 'submitted', transaction_hash: transactionHash })

    const second = await reconcilePaymentIntents(db, 'test-albatross', rpc)
    expect(second).toMatchObject({ pending: 0, verified: 1 })
    expect(rpc.getTransactionsByAddress).toHaveBeenCalledTimes(1)
    expect(rpc.getTransaction).toHaveBeenCalledTimes(1)
    expect(database.prepare('SELECT status, transaction_hash FROM payment_intents WHERE id = ?').get(intent.id))
      .toEqual({ status: 'confirmed', transaction_hash: transactionHash })
  })

  it('expires only unpaid intents after the inclusion grace window', async () => {
    const unpaidProduct = await publishProduct('RECOVER-EXPIRE-UNPAID')
    const unpaid = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(unpaidProduct, 'purchase-attempt-recover-0003')
    ).json())
    const paidProduct = await publishProduct('RECOVER-EXPIRE-PAID')
    const paid = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(paidProduct, 'purchase-attempt-recover-0004')
    ).json())
    const paidHash = '9'.repeat(64)
    await submitPaymentIntent(db, paid.id, buyerAddress, paidHash, paid.createdAt)
    const afterGrace = new Date(Math.max(Date.parse(unpaid.expiresAt), Date.parse(paid.expiresAt)) + 120_001)
    const rpc = {
      getTransaction: vi.fn().mockResolvedValue({ status: 'not_found' }),
      getTransactionsByAddress: vi.fn().mockResolvedValue({ status: 'found', transactions: [] }),
    }

    await reconcilePaymentIntents(db, 'test-albatross', rpc, afterGrace)
    expect(database.prepare(`
      SELECT
        (SELECT status FROM payment_intents WHERE id = ?) AS unpaid,
        (SELECT status FROM payment_intents WHERE id = ?) AS paid
    `).get(unpaid.id, paid.id)).toEqual({ paid: 'submitted', unpaid: 'expired' })
  })

  it('preserves a wallet-returned hash even when API delivery happens after display expiry', async () => {
    const productId = await publishProduct('SUBMISSION-EXPIRED')
    const intent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(productId, 'purchase-attempt-0012')
    ).json())

    await expect(recordPaymentSubmission(
      db,
      intent.id,
      buyerAddress,
      'c'.repeat(64),
      new Date(Date.parse(intent.expiresAt) + 1),
    )).resolves.toMatchObject({ status: 'submitted', transactionHash: 'c'.repeat(64) })
    expect((database.prepare('SELECT status FROM payment_intents WHERE id = ?').get(intent.id) as { status: string }).status)
      .toBe('submitted')
  })

  it('enforces pending, submitted, confirmed, expired, and failed transitions', async () => {
    const confirmedProduct = await publishProduct('STATE-CONFIRMED')
    const confirmedIntent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(confirmedProduct, 'purchase-attempt-0008')
    ).json())
    const submittedAt = new Date(Date.parse(confirmedIntent.createdAt) + 1_000).toISOString()
    const transactionHash = '1'.repeat(64)
    expect(await submitPaymentIntent(db, confirmedIntent.id, buyerAddress, transactionHash, submittedAt)).toBe(true)
    expect(await confirmPaymentIntent(db, confirmedIntent.id, transactionHash, 42, submittedAt)).toBe(true)

    const expiredProduct = await publishProduct('STATE-EXPIRED')
    const expiredIntent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(expiredProduct, 'purchase-attempt-0009')
    ).json())
    await expirePendingPurchaseIntents(
      db,
      expiredProduct,
      new Date(Date.parse(expiredIntent.expiresAt) + 1).toISOString(),
    )

    const failedProduct = await publishProduct('STATE-FAILED')
    const failedIntent = PurchaseIntentResponseSchema.parse(await (
      await requestIntent(failedProduct, 'purchase-attempt-0010')
    ).json())
    expect(await failPaymentIntent(db, failedIntent.id, 'provider_rejected', failedIntent.createdAt)).toBe(true)

    const states = database.prepare(`
      SELECT
        (SELECT status FROM payment_intents WHERE id = ?) AS confirmed,
        (SELECT status FROM payment_intents WHERE id = ?) AS expired,
        (SELECT status FROM payment_intents WHERE id = ?) AS failed
    `).get(confirmedIntent.id, expiredIntent.id, failedIntent.id) as Record<string, string>
    expect(states).toEqual({ confirmed: 'confirmed', expired: 'expired', failed: 'failed' })
    expect(() => database.prepare(`
      UPDATE payment_intents SET amount_luna = 1 WHERE id = ?
    `).run(failedIntent.id)).toThrow(/payment_intent_values_are_immutable/)
    expect(() => database.prepare(`
      UPDATE payment_intents SET status = 'pending' WHERE id = ?
    `).run(confirmedIntent.id)).toThrow(/payment_intent/)
  })
})
