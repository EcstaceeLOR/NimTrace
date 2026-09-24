import { readFileSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../proofs/verifier', () => ({
  verifySignedProof: vi.fn().mockResolvedValue({ ok: true }),
}))

import { getPublicProduct, listPublicProducts } from './public'

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

  async all<T>() {
    return { results: this.#statement.all(...this.#values) as T[] }
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
  } as unknown as D1Database
}

const PRODUCT_ID = 'product-lifecycle-test-0001'
const ISSUER = 'NQ11 TEST ISSUER ADDRESS 000000000000000000'
const BUYER = 'NQ22 TEST BUYER ADDRESS 0000000000000000000'
const PAYLOAD_HASH = 'a'.repeat(64)
const SERIAL_HASH = 'b'.repeat(64)
const IMAGE_HASH = 'c'.repeat(64)
const CREATED_AT = '2026-09-23T20:00:00.000Z'

function seedProduct(database: DatabaseSync) {
  const payload = {
    description: 'Backend lifecycle test product.',
    imageHash: IMAGE_HASH,
    imageKey: 'products/test/lifecycle.webp',
    issuerAddress: ISSUER,
    priceLuna: 100000,
    productId: PRODUCT_ID,
    serialNumberHash: SERIAL_HASH,
    title: 'Lifecycle Test Product',
    version: 1,
    warrantyDurationDays: 365,
    warrantySummary: 'One year test warranty.',
  }
  const envelope = {
    action: 'ISSUE_PRODUCT',
    app: 'nimtrace',
    expiresAt: '2026-09-23T21:00:00.000Z',
    issuedAt: CREATED_AT,
    network: 'main-albatross',
    nonce: 'lifecycle-proof-nonce-0001',
    payloadHash: PAYLOAD_HASH,
    previousEventHash: null,
    summary: 'Issue lifecycle test product.',
    version: 1,
  }

  database.prepare(`
    INSERT INTO merchants (wallet_address, profile_slug, status, created_at, updated_at)
    VALUES (?, 'lifecycle-test-merchant', 'active', ?, ?)
  `).run(ISSUER, CREATED_AT, CREATED_AT)

  database.prepare(`
    INSERT INTO products (
      id, issuer_address, title, serial_number_hash, description, image_key, image_hash,
      warranty_duration_days, current_version, status, created_at, updated_at,
      price_luna, warranty_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'offered', ?, ?, ?, ?)
  `).run(
    PRODUCT_ID,
    ISSUER,
    payload.title,
    SERIAL_HASH,
    payload.description,
    payload.imageKey,
    IMAGE_HASH,
    payload.warrantyDurationDays,
    CREATED_AT,
    CREATED_AT,
    payload.priceLuna,
    payload.warrantySummary,
  )

  database.prepare(`
    INSERT INTO product_versions (
      product_id, version, canonical_payload, payload_hash, issuer_public_key,
      issuer_signature, created_at, proof_envelope
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
  `).run(
    PRODUCT_ID,
    JSON.stringify({ data: payload }),
    PAYLOAD_HASH,
    'd'.repeat(64),
    'e'.repeat(128),
    CREATED_AT,
    JSON.stringify(envelope),
  )
}

function createActiveCheckout(database: DatabaseSync) {
  database.prepare(`
    INSERT INTO payment_intents (
      id, purpose, product_id, product_version, seller_address, buyer_address,
      amount_luna, network, transaction_data, expires_at, status,
      idempotency_key_hash, created_at, updated_at
    ) VALUES (?, 'initial_purchase', ?, 1, ?, ?, 100000, 'main-albatross', ?, ?, 'pending', ?, ?, ?)
  `).run(
    'checkout-lifecycle-0001',
    PRODUCT_ID,
    ISSUER,
    BUYER,
    'NTP1:lifecycle-active',
    '2099-01-01T00:10:00.000Z',
    'f'.repeat(64),
    CREATED_AT,
    CREATED_AT,
  )
}

describe('public catalogue backend lifecycle projection', () => {
  let database: DatabaseSync
  let db: D1Database

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(migrations)
    seedProduct(database)
    db = databasePort(database)
  })

  afterEach(() => database.close())

  it('moves a product exclusively through available, checked_out, and owned from persisted backend state', async () => {
    const available = await getPublicProduct(
      db,
      PRODUCT_ID,
      'main-albatross',
      undefined,
      new Date('2026-09-23T20:01:00.000Z'),
    )
    expect(available.state).toBe('available')
    expect((await listPublicProducts(db, 'main-albatross')).items.map((item) => item.state)).toEqual(['available'])

    createActiveCheckout(database)

    const reserved = await getPublicProduct(
      db,
      PRODUCT_ID,
      'main-albatross',
      undefined,
      new Date('2026-09-23T20:02:00.000Z'),
      false,
    )
    expect(reserved.state).toBe('checked_out')
    expect(reserved.checkoutProgress).toBeNull()
    expect((await listPublicProducts(db, 'main-albatross')).items.map((item) => item.state)).toEqual(['checked_out'])

    database.prepare(`
      UPDATE payment_intents
      SET status = 'expired', updated_at = '2026-09-23T20:03:00.000Z'
      WHERE id = 'checkout-lifecycle-0001'
    `).run()

    const released = await getPublicProduct(
      db,
      PRODUCT_ID,
      'main-albatross',
      undefined,
      new Date('2026-09-23T20:04:00.000Z'),
    )
    expect(released.state).toBe('available')
    expect((await listPublicProducts(db, 'main-albatross')).items.map((item) => item.state)).toEqual(['available'])

    database.prepare(`UPDATE products SET status = 'sold', updated_at = '2026-09-23T20:05:00.000Z' WHERE id = ?`)
      .run(PRODUCT_ID)

    const completed = await getPublicProduct(
      db,
      PRODUCT_ID,
      'main-albatross',
      undefined,
      new Date('2026-09-23T20:06:00.000Z'),
    )
    expect(completed.state).toBe('owned')
    expect((await listPublicProducts(db, 'main-albatross')).items.map((item) => item.state)).toEqual(['owned'])
  })
})
