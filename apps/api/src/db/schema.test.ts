import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UPDATE_PASSPORT_OWNER_SQL } from './passports'

const migration = [
  '0001_lifecycle_schema.sql',
  '0002_wallet_auth_invariants.sql',
  '0003_product_issuance.sql',
].map((name) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')).join('\n')
const hash = (character: string) => character.repeat(64)
const address = (suffix: string) => `NQ00NIMTRACE${suffix.padStart(12, '0')}`

function seedProduct(database: DatabaseSync) {
  database.exec(`
    INSERT INTO merchants (wallet_address, display_name, profile_slug)
    VALUES ('${address('1')}', 'NimTrace Foundry', 'nimtrace-foundry');
    INSERT INTO products (id, issuer_address, title, warranty_duration_days, status)
    VALUES ('product-1', '${address('1')}', 'Genesis Edition', 365, 'offered');
    INSERT INTO product_versions (
      product_id, version, canonical_payload, payload_hash, issuer_public_key, issuer_signature
    ) VALUES (
      'product-1', 1, '{"title":"Genesis Edition"}', '${hash('a')}',
      '${'p'.repeat(64)}', '${'s'.repeat(128)}'
    );
  `)
}

function seedPassport(database: DatabaseSync) {
  seedProduct(database)
  database.exec(`
    INSERT INTO payment_intents (
      id, purpose, product_id, seller_address, buyer_address, amount_luna,
      transaction_data, expires_at, status, transaction_hash, confirmed_block_height, confirmed_at
    ) VALUES (
      'payment-1', 'initial_purchase', 'product-1', '${address('1')}', '${address('2')}',
      100000, 'NTRC-PURCHASE-0001', '2099-01-01T00:00:00.000Z', 'confirmed',
      '${hash('b')}', 42, '2026-09-14T12:00:00.000Z'
    );
    INSERT INTO passports (
      id, product_id, product_version, current_owner_address, purchase_intent_id,
      warranty_started_at, warranty_expires_at
    ) VALUES (
      'passport-1', 'product-1', 1, '${address('2')}', 'payment-1',
      '2026-09-14T12:00:00.000Z', '2027-09-14T12:00:00.000Z'
    );
    INSERT INTO passport_events (
      id, passport_id, sequence, type, previous_event_hash, canonical_payload,
      payload_hash, event_hash, actor_address, actor_public_key, actor_signature, payment_intent_id
    ) VALUES (
      'event-1', 'passport-1', 1, 'issued', NULL, '{"type":"issued"}',
      '${hash('c')}', '${hash('d')}', '${address('1')}', '${'q'.repeat(64)}',
      '${'t'.repeat(128)}', 'payment-1'
    );
  `)
}

describe('D1 lifecycle migration', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec(migration)
  })

  afterEach(() => database.close())

  it('creates every lifecycle table', () => {
    const rows = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>

    expect(rows.map(({ name }) => name)).toEqual([
      'merchants', 'passport_events', 'passports', 'payment_intents', 'product_versions',
      'products', 'proof_nonces', 'repair_attestations', 'transfer_intents', 'wallet_challenges',
      'wallet_sessions',
    ])
  })

  it('enforces transaction-hash and event-sequence uniqueness', () => {
    seedPassport(database)
    expect(() => database.exec(`
      INSERT INTO payment_intents (
        id, purpose, product_id, seller_address, buyer_address, amount_luna,
        transaction_data, expires_at, status, transaction_hash, confirmed_block_height, confirmed_at
      ) VALUES (
        'payment-2', 'initial_purchase', 'product-1', '${address('1')}', '${address('3')}',
        200000, 'NTRC-PURCHASE-0002', '2099-01-01T00:00:00.000Z', 'confirmed',
        '${hash('b')}', 43, '2026-09-14T12:01:00.000Z'
      );
    `)).toThrow(/UNIQUE constraint failed: payment_intents.transaction_hash/)

    expect(() => database.exec(`
      INSERT INTO passport_events (
        id, passport_id, sequence, type, previous_event_hash, canonical_payload,
        payload_hash, event_hash, actor_address, actor_public_key, actor_signature
      ) VALUES (
        'event-duplicate', 'passport-1', 1, 'corrected', '${hash('d')}', '{"type":"corrected"}',
        '${hash('e')}', '${hash('f')}', '${address('2')}', '${'r'.repeat(64)}', '${'u'.repeat(128)}'
      );
    `)).toThrow()
  })

  it('supports optimistic concurrency with one version increment per update', () => {
    seedPassport(database)
    const statement = database.prepare(UPDATE_PASSPORT_OWNER_SQL)
    const first = statement.run(address('3'), 'active', '2098-09-14T12:02:00.000Z', 'passport-1', 2)
    const stale = statement.run(address('4'), 'active', '2098-09-14T12:03:00.000Z', 'passport-1', 2)
    const row = database.prepare(`
      SELECT current_owner_address, version FROM passports WHERE id = 'passport-1'
    `).get() as { current_owner_address: string; version: number }

    expect(first.changes).toBe(1)
    expect(stale.changes).toBe(0)
    expect(row).toEqual({ current_owner_address: address('3'), version: 3 })
  })

  it('rolls back the unit of work after a constraint failure', () => {
    database.exec('BEGIN')
    expect(() => database.exec(`
      INSERT INTO merchants (wallet_address, profile_slug)
      VALUES ('${address('8')}', 'rollback-merchant');
      INSERT INTO products (id, issuer_address, title, status)
      VALUES ('bad-product', '${address('8')}', 'Invalid product', 'unknown');
    `)).toThrow(/CHECK constraint failed/)
    database.exec('ROLLBACK')

    const result = database.prepare(`
      SELECT COUNT(*) AS count FROM merchants WHERE profile_slug = 'rollback-merchant'
    `).get() as { count: number }
    expect(result.count).toBe(0)
  })

  it('enforces foreign keys, lifecycle checks, and append-only records', () => {
    seedPassport(database)
    expect(() => database.exec(`
      INSERT INTO products (id, issuer_address, title)
      VALUES ('orphan', '${address('9')}', 'Orphaned product');
    `)).toThrow(/FOREIGN KEY constraint failed/)
    expect(() => database.exec(`
      UPDATE product_versions SET canonical_payload = '{"changed":true}'
      WHERE product_id = 'product-1' AND version = 1;
    `)).toThrow(/product_versions_are_immutable/)
    expect(() => database.exec("DELETE FROM passport_events WHERE id = 'event-1';"))
      .toThrow(/passport_events_are_immutable/)
    expect(() => database.exec(`
      UPDATE passports SET status = 'invalid', version = version + 1 WHERE id = 'passport-1';
    `)).toThrow(/CHECK constraint failed/)
  })

  it('atomically consumes a challenge when its session is inserted', () => {
    const createdAt = '2026-09-14T12:00:00.000Z'
    database.prepare(`
      INSERT INTO wallet_challenges (
        id, wallet_address, challenge_hash, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run('challenge-atomic', address('2'), hash('a'), '2026-09-14T12:05:00.000Z', createdAt)

    database.prepare(`
      INSERT INTO wallet_sessions (
        id, wallet_address, challenge_id, token_hash, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-1', address('2'), 'challenge-atomic', hash('b'),
      '2026-09-15T12:00:00.000Z', createdAt, createdAt,
    )

    const challenge = database.prepare(`
      SELECT consumed_at FROM wallet_challenges WHERE id = 'challenge-atomic'
    `).get() as { consumed_at: string }
    expect(challenge.consumed_at).toBe(createdAt)

    expect(() => database.prepare(`
      INSERT INTO wallet_sessions (
        id, wallet_address, challenge_id, token_hash, expires_at, last_seen_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-2', address('2'), 'challenge-atomic', hash('c'),
      '2026-09-15T12:00:00.000Z', createdAt, createdAt,
    )).toThrow(/challenge_unavailable/)
  })

  it('preserves signed versions and represents edits as the next version', () => {
    seedProduct(database)
    database.prepare(`
      INSERT INTO product_versions (
        product_id, version, canonical_payload, payload_hash, issuer_public_key, issuer_signature
      ) VALUES (?, 2, ?, ?, ?, ?)
    `).run(
      'product-1',
      '{"title":"Genesis Edition v2"}',
      hash('z'),
      'v'.repeat(64),
      'w'.repeat(128),
    )

    const product = database.prepare(`
      SELECT current_version FROM products WHERE id = 'product-1'
    `).get() as { current_version: number }
    const versions = database.prepare(`
      SELECT version FROM product_versions WHERE product_id = 'product-1' ORDER BY version
    `).all() as Array<{ version: number }>

    expect(product.current_version).toBe(2)
    expect(versions).toEqual([{ version: 1 }, { version: 2 }])
    expect(() => database.prepare(`
      UPDATE product_versions SET canonical_payload = '{}' WHERE product_id = 'product-1' AND version = 1
    `).run()).toThrow(/product_versions_are_immutable/)
  })
})
