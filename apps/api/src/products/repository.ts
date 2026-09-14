import type { ProductPayload } from '@nimtrace/contracts'

export interface ProofNonceRow {
  action: string
  consumed_at: string | null
  expires_at: string
  id: string
  payload_hash: string
  resource_id: string
  wallet_address: string
}

export async function insertProofNonce(db: D1Database, row: ProofNonceRow, createdAt: string) {
  await db.prepare(`
    INSERT INTO proof_nonces (
      id, wallet_address, action, resource_id, payload_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id,
    row.wallet_address,
    row.action,
    row.resource_id,
    row.payload_hash,
    row.expires_at,
    createdAt,
  ).run()
}

export async function findProofNonce(db: D1Database, id: string): Promise<ProofNonceRow | null> {
  return db.prepare(`
    SELECT id, wallet_address, action, resource_id, payload_hash, expires_at, consumed_at
    FROM proof_nonces WHERE id = ?
  `).bind(id).first<ProofNonceRow>()
}

interface PublishProductInput {
  createdAt: string
  envelopeJson: string
  nonce: string
  payload: ProductPayload
  payloadHash: string
  payloadJson: string
  publicKey: string
  signature: string
}

export async function publishProduct(db: D1Database, input: PublishProductInput): Promise<void> {
  const merchantSlug = `merchant-${input.payload.issuerAddress.replaceAll(' ', '').slice(-12).toLowerCase()}`
  await db.batch([
    db.prepare(`
      INSERT INTO merchants (wallet_address, profile_slug)
      VALUES (?, ?) ON CONFLICT(wallet_address) DO NOTHING
    `).bind(input.payload.issuerAddress, merchantSlug),
    db.prepare(`
      INSERT INTO products (
        id, issuer_address, title, serial_number_hash, description, image_key, image_hash,
        warranty_duration_days, price_luna, warranty_summary, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered', ?, ?)
    `).bind(
      input.payload.productId,
      input.payload.issuerAddress,
      input.payload.title,
      input.payload.serialNumberHash,
      input.payload.description,
      input.payload.imageKey,
      input.payload.imageHash,
      input.payload.warrantyDurationDays,
      input.payload.priceLuna,
      input.payload.warrantySummary,
      input.createdAt,
      input.createdAt,
    ),
    db.prepare(`
      INSERT INTO product_versions (
        product_id, version, canonical_payload, payload_hash, issuer_public_key,
        issuer_signature, proof_envelope, proof_nonce, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.payload.productId,
      input.payload.version,
      input.payloadJson,
      input.payloadHash,
      input.publicKey,
      input.signature,
      input.envelopeJson,
      input.nonce,
      input.createdAt,
    ),
  ])
}
