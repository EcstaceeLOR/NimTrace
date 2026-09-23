import {
  ProductPayloadSchema,
  ProofEnvelopeSchema,
  PublicProductListResponseSchema,
  type NimiqNetwork,
  type PublicProductResponse,
} from '@nimtrace/contracts'
import { DEMO_IMAGE_KEY } from '../images/service'
import { INCLUSION_GRACE_MS } from '../payments/verification'
import { verifySignedProof } from '../proofs/verifier'

interface PublicProductRow {
  canonical_payload: string
  current_version: number
  description: string
  has_active_checkout: number
  image_key: string | null
  issued_at: string
  issuer_address: string
  issuer_public_key: string
  issuer_signature: string
  payload_hash: string
  price_luna: number
  product_id: string
  product_status: string
  proof_envelope: string | null
  serial_number_hash: string | null
  title: string
  version: number
  warranty_duration_days: number
  warranty_summary: string
}

export class PublicProductError extends Error {}

async function productRow(
  db: D1Database,
  productId: string,
  activeCheckoutCutoff: string,
  version?: number,
) {
  const base = `
    SELECT
      products.id AS product_id,
      products.issuer_address,
      products.title,
      products.description,
      products.image_key,
      products.serial_number_hash,
      products.price_luna,
      products.warranty_duration_days,
      products.warranty_summary,
      products.status AS product_status,
      products.current_version,
      CASE WHEN EXISTS (
        SELECT 1
        FROM payment_intents
        WHERE payment_intents.product_id = products.id
          AND payment_intents.purpose = 'initial_purchase'
          AND (
            payment_intents.status IN ('submitted', 'confirmed')
            OR (
              payment_intents.status = 'pending'
              AND payment_intents.expires_at > ?
            )
          )
      ) THEN 1 ELSE 0 END AS has_active_checkout,
      product_versions.version,
      product_versions.canonical_payload,
      product_versions.payload_hash,
      product_versions.issuer_public_key,
      product_versions.issuer_signature,
      product_versions.proof_envelope,
      product_versions.created_at AS issued_at
    FROM products
    JOIN product_versions ON product_versions.product_id = products.id
    WHERE products.id = ?
  `
  if (version === undefined) {
    return db.prepare(`${base} AND product_versions.version = products.current_version`)
      .bind(activeCheckoutCutoff, productId).first<PublicProductRow>()
  }
  return db.prepare(`${base} AND product_versions.version = ?`)
    .bind(activeCheckoutCutoff, productId, version).first<PublicProductRow>()
}

export async function getPublicProduct(
  db: D1Database,
  productId: string,
  network: NimiqNetwork,
  version?: number,
  now = new Date(),
): Promise<PublicProductResponse> {
  const activeCheckoutCutoff = new Date(now.getTime() - INCLUSION_GRACE_MS).toISOString()
  const row = await productRow(db, productId, activeCheckoutCutoff, version)
  if (!row) throw new PublicProductError('Product not found.')

  const wrappedPayload = (() => {
    try {
      return JSON.parse(row.canonical_payload) as { data?: unknown }
    } catch {
      return null
    }
  })()
  const payload = ProductPayloadSchema.safeParse(wrappedPayload?.data)
  const envelope = (() => {
    try {
      return ProofEnvelopeSchema.safeParse(JSON.parse(row.proof_envelope ?? 'null'))
    } catch {
      return { success: false as const }
    }
  })()

  let verified = false
  if (payload.success && envelope.success) {
    const proof = await verifySignedProof({
      envelope: envelope.data,
      payload: payload.data,
      publicKey: row.issuer_public_key,
      signature: row.issuer_signature,
    }, {
      action: 'ISSUE_PRODUCT',
      network,
      nonce: envelope.data.nonce,
      now: new Date(envelope.data.issuedAt),
      previousEventHash: null,
      signerAddress: row.issuer_address,
    })
    verified = proof.ok
      && row.payload_hash === envelope.data.payloadHash
      && payload.data.productId === row.product_id
      && payload.data.version === row.version
      && payload.data.issuerAddress === row.issuer_address
  }

  const signed = payload.success ? payload.data : null
  const state = !verified
    ? 'invalid'
    : row.product_status === 'suspended'
      ? 'suspended'
      : row.product_status === 'retired' || row.version < row.current_version
        ? 'replaced'
        : row.product_status === 'offered'
          ? row.has_active_checkout === 1
            ? 'checked_out'
            : 'available'
          : row.product_status === 'sold'
            ? 'owned'
            : 'invalid'

  const imageKey = signed?.imageKey ?? row.image_key ?? DEMO_IMAGE_KEY
  return {
    currentVersion: row.current_version,
    description: signed?.description ?? row.description,
    id: row.product_id,
    imageUrl: imageKey === DEMO_IMAGE_KEY
      ? '/demo-product.svg'
      : `/api/product-images?key=${encodeURIComponent(imageKey)}`,
    issuedAt: row.issued_at,
    issuerAddress: row.issuer_address,
    priceLuna: signed?.priceLuna ?? row.price_luna,
    proofHash: row.payload_hash,
    serialFingerprint: (signed?.serialNumberHash ?? row.serial_number_hash ?? '0'.repeat(64)).slice(0, 12),
    signatureState: verified ? 'verified' : 'invalid',
    state,
    title: signed?.title ?? row.title,
    version: row.version,
    warrantyDurationDays: signed?.warrantyDurationDays ?? row.warranty_duration_days,
    warrantySummary: signed?.warrantySummary ?? row.warranty_summary,
  }
}

export async function listPublicProducts(
  db: D1Database,
  network: NimiqNetwork,
  search = '',
) {
  const needle = search.trim().slice(0, 80)
  const query = needle
    ? `SELECT id FROM products WHERE status IN ('offered', 'sold') AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT 50`
    : `SELECT id FROM products WHERE status IN ('offered', 'sold') ORDER BY updated_at DESC LIMIT 50`
  const rows = needle
    ? await db.prepare(query).bind(`%${needle}%`, `%${needle}%`).all<{ id: string }>()
    : await db.prepare(query).all<{ id: string }>()
  const items: PublicProductResponse[] = []
  for (const row of rows.results) {
    try {
      const product = await getPublicProduct(db, row.id, network)
      if (
        product.signatureState === 'verified'
        && ['available', 'checked_out', 'owned'].includes(product.state)
      ) items.push(product)
    } catch {
      // Ignore a malformed listing; the public catalogue must never expose unverified records.
    }
  }
  return PublicProductListResponseSchema.parse({ items })
}
