import {
  IssuedPassportResponseSchema,
  type IssuedPassportResponse,
  type PaymentIntentStatus,
} from '@nimtrace/contracts'

export interface PassportIssuanceMaterial {
  buyerAddress: string
  confirmedAt: string | null
  confirmedBlockHeight: number | null
  issuerAddress: string
  issuerPublicKey: string
  issuerSignature: string
  paymentStatus: PaymentIntentStatus
  productId: string
  productPayloadHash: string
  productVersion: number
  transactionHash: string | null
  warrantyDurationDays: number
}

interface PassportIssuanceMaterialRow {
  buyer_address: string
  confirmed_at: string | null
  confirmed_block_height: number | null
  issuer_address: string
  issuer_public_key: string
  issuer_signature: string
  payment_status: PaymentIntentStatus
  product_id: string
  product_payload_hash: string
  product_version: number
  transaction_hash: string | null
  warranty_duration_days: number
}

export interface StoredIssuedPassport {
  canonicalPayload: string
  currentOwnerAddress: string
  eventCreatedAt: string
  eventHash: string
  eventPayloadHash: string
  eventPreviousHash: string | null
  eventSequence: number
  eventType: string
  headEventHash: string
  id: string
  productId: string
  productPayloadHash: string
  productVersion: number
  purchaseBlockHeight: number
  purchaseBuyerAddress: string
  purchaseConfirmedAt: string
  purchaseIntentId: string
  purchaseTransactionHash: string
  status: string
  version: number
  warrantyExpiresAt: string
  warrantyStartedAt: string
}

interface StoredIssuedPassportRow {
  canonical_payload: string
  current_owner_address: string
  event_created_at: string
  event_hash: string
  event_payload_hash: string
  event_previous_hash: string | null
  event_sequence: number
  event_type: string
  head_event_hash: string
  id: string
  product_id: string
  product_payload_hash: string
  product_version: number
  purchase_block_height: number
  purchase_buyer_address: string
  purchase_confirmed_at: string
  purchase_intent_id: string
  purchase_transaction_hash: string
  status: string
  version: number
  warranty_expires_at: string
  warranty_started_at: string
}

export interface CreatePassportBatchInput {
  confirmedAt: string
  confirmedBlockHeight: number
  createdAt: string
  eventHash: string
  eventId: string
  eventPayload: string
  eventPayloadHash: string
  intentId: string
  passportId: string
  transactionHash: string
  warrantyExpiresAt: string
}

export async function findPassportIssuanceMaterial(
  db: D1Database,
  intentId: string,
): Promise<PassportIssuanceMaterial | null> {
  const row = await db.prepare(`
    SELECT
      payment_intents.buyer_address,
      payment_intents.confirmed_at,
      payment_intents.confirmed_block_height,
      payment_intents.status AS payment_status,
      payment_intents.product_id,
      payment_intents.product_version,
      payment_intents.transaction_hash,
      products.issuer_address,
      products.warranty_duration_days,
      product_versions.payload_hash AS product_payload_hash,
      product_versions.issuer_public_key,
      product_versions.issuer_signature
    FROM payment_intents
    JOIN products ON products.id = payment_intents.product_id
    JOIN product_versions
      ON product_versions.product_id = payment_intents.product_id
      AND product_versions.version = payment_intents.product_version
    WHERE payment_intents.id = ? AND payment_intents.purpose = 'initial_purchase'
  `).bind(intentId).first<PassportIssuanceMaterialRow>()
  if (!row) return null
  return {
    buyerAddress: row.buyer_address,
    confirmedAt: row.confirmed_at,
    confirmedBlockHeight: row.confirmed_block_height,
    issuerAddress: row.issuer_address,
    issuerPublicKey: row.issuer_public_key,
    issuerSignature: row.issuer_signature,
    paymentStatus: row.payment_status,
    productId: row.product_id,
    productPayloadHash: row.product_payload_hash,
    productVersion: row.product_version,
    transactionHash: row.transaction_hash,
    warrantyDurationDays: row.warranty_duration_days,
  }
}

function storedPassport(row: StoredIssuedPassportRow): StoredIssuedPassport {
  return {
    canonicalPayload: row.canonical_payload,
    currentOwnerAddress: row.current_owner_address,
    eventCreatedAt: row.event_created_at,
    eventHash: row.event_hash,
    eventPayloadHash: row.event_payload_hash,
    eventPreviousHash: row.event_previous_hash,
    eventSequence: row.event_sequence,
    eventType: row.event_type,
    headEventHash: row.head_event_hash,
    id: row.id,
    productId: row.product_id,
    productPayloadHash: row.product_payload_hash,
    productVersion: row.product_version,
    purchaseBlockHeight: row.purchase_block_height,
    purchaseBuyerAddress: row.purchase_buyer_address,
    purchaseConfirmedAt: row.purchase_confirmed_at,
    purchaseIntentId: row.purchase_intent_id,
    purchaseTransactionHash: row.purchase_transaction_hash,
    status: row.status,
    version: row.version,
    warrantyExpiresAt: row.warranty_expires_at,
    warrantyStartedAt: row.warranty_started_at,
  }
}

export async function findIssuedPassportByIntent(
  db: D1Database,
  intentId: string,
): Promise<StoredIssuedPassport | null> {
  const row = await db.prepare(`
    SELECT
      passports.id,
      passports.product_id,
      passports.product_version,
      passports.current_owner_address,
      passports.purchase_intent_id,
      passports.warranty_started_at,
      passports.warranty_expires_at,
      passports.head_event_hash,
      passports.status,
      passports.version,
      payment_intents.transaction_hash AS purchase_transaction_hash,
      payment_intents.buyer_address AS purchase_buyer_address,
      payment_intents.confirmed_block_height AS purchase_block_height,
      payment_intents.confirmed_at AS purchase_confirmed_at,
      product_versions.payload_hash AS product_payload_hash,
      passport_events.sequence AS event_sequence,
      passport_events.type AS event_type,
      passport_events.previous_event_hash AS event_previous_hash,
      passport_events.canonical_payload,
      passport_events.payload_hash AS event_payload_hash,
      passport_events.event_hash,
      passport_events.created_at AS event_created_at
    FROM passports
    JOIN payment_intents ON payment_intents.id = passports.purchase_intent_id
    JOIN product_versions
      ON product_versions.product_id = passports.product_id
      AND product_versions.version = passports.product_version
    JOIN passport_events
      ON passport_events.passport_id = passports.id AND passport_events.sequence = 1
    WHERE passports.purchase_intent_id = ?
  `).bind(intentId).first<StoredIssuedPassportRow>()
  return row ? storedPassport(row) : null
}

export async function createPassportIssuanceBatch(
  db: D1Database,
  material: PassportIssuanceMaterial,
  input: CreatePassportBatchInput,
) {
  await db.batch([
    db.prepare(`
      UPDATE payment_intents
      SET status = 'confirmed', confirmed_block_height = ?, confirmed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'submitted' AND transaction_hash = ?
    `).bind(
      input.confirmedBlockHeight,
      input.confirmedAt,
      input.confirmedAt,
      input.intentId,
      input.transactionHash,
    ),
    db.prepare(`
      INSERT INTO passports (
        id, product_id, product_version, current_owner_address, purchase_intent_id,
        warranty_started_at, warranty_expires_at, status, created_at, updated_at
      )
      SELECT ?, product_id, product_version, buyer_address, id, ?, ?, 'suspended', ?, ?
      FROM payment_intents
      WHERE id = ? AND purpose = 'initial_purchase' AND status = 'confirmed'
        AND transaction_hash = ? AND confirmed_block_height = ? AND confirmed_at = ?
    `).bind(
      input.passportId,
      input.confirmedAt,
      input.warrantyExpiresAt,
      input.createdAt,
      input.createdAt,
      input.intentId,
      input.transactionHash,
      input.confirmedBlockHeight,
      input.confirmedAt,
    ),
    db.prepare(`
      INSERT INTO passport_events (
        id, passport_id, sequence, type, previous_event_hash, canonical_payload,
        payload_hash, event_hash, actor_address, actor_public_key, actor_signature,
        payment_intent_id, created_at
      ) VALUES (?, ?, 1, 'issued', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.eventId,
      input.passportId,
      input.eventPayload,
      input.eventPayloadHash,
      input.eventHash,
      material.issuerAddress,
      material.issuerPublicKey,
      material.issuerSignature,
      input.intentId,
      input.createdAt,
    ),
  ])
}

export function passportResponse(record: StoredIssuedPassport): IssuedPassportResponse {
  return IssuedPassportResponseSchema.parse({
    auditState: 'verified',
    currentOwnerAddress: record.currentOwnerAddress,
    firstEventHash: record.eventHash,
    headEventHash: record.headEventHash,
    id: record.id,
    issuedAt: record.eventCreatedAt,
    productId: record.productId,
    productVersion: record.productVersion,
    purchaseBlockHeight: record.purchaseBlockHeight,
    purchaseIntentId: record.purchaseIntentId,
    purchaseTransactionHash: record.purchaseTransactionHash,
    status: record.status,
    version: record.version,
    warrantyExpiresAt: record.warrantyExpiresAt,
    warrantyStartedAt: record.warrantyStartedAt,
  })
}

interface PassportAccessRow {
  id: string
  ownership: 'current' | 'former'
}

export interface PassportDetailRecord {
  currentOwnerAddress: string
  description: string
  headEventHash: string
  id: string
  imageKey: string | null
  issuerAddress: string
  issuedAt: string
  ownership: 'current' | 'former'
  productId: string
  productTitle: string
  productVersion: number
  purchaseBlockHeight: number
  purchaseConfirmedAt: string
  purchaseIntentId: string
  purchaseTransactionHash: string
  status: 'active' | 'transfer_pending' | 'suspended' | 'retired'
  warrantyDurationDays: number
  warrantyExpiresAt: string
  warrantyStartedAt: string
  warrantySummary: string
}

interface PassportDetailRow {
  current_owner_address: string
  description: string
  head_event_hash: string
  id: string
  image_key: string | null
  issuer_address: string
  issued_at: string
  ownership: 'current' | 'former'
  product_id: string
  product_title: string
  product_version: number
  purchase_block_height: number
  purchase_confirmed_at: string
  purchase_intent_id: string
  purchase_transaction_hash: string
  status: PassportDetailRecord['status']
  warranty_duration_days: number
  warranty_expires_at: string
  warranty_started_at: string
  warranty_summary: string
}

export interface PassportEventRecord {
  actorAddress: string
  createdAt: string
  eventHash: string
  previousEventHash: string | null
  sequence: number
  type: 'issued' | 'transferred' | 'repaired' | 'warranty_claimed' | 'corrected' | 'retired'
}

interface PassportEventRow {
  actor_address: string
  created_at: string
  event_hash: string
  previous_event_hash: string | null
  sequence: number
  type: PassportEventRecord['type']
}

export async function listWalletPassportAccess(
  db: D1Database,
  walletAddress: string,
  includeHistory: boolean,
) {
  const result = await db.prepare(`
    SELECT passports.id,
      CASE WHEN passports.current_owner_address = ? THEN 'current' ELSE 'former' END AS ownership
    FROM passports
    JOIN payment_intents ON payment_intents.id = passports.purchase_intent_id
    WHERE passports.current_owner_address = ?
      OR (? = 1 AND (
        payment_intents.buyer_address = ?
        OR EXISTS (
          SELECT 1 FROM passport_events
          WHERE passport_events.passport_id = passports.id
            AND passport_events.type = 'transferred'
            AND passport_events.actor_address = ?
        )
      ))
    ORDER BY passports.created_at DESC, passports.id
  `).bind(
    walletAddress,
    walletAddress,
    includeHistory ? 1 : 0,
    walletAddress,
    walletAddress,
  ).all<PassportAccessRow>()
  return result.results
}

export async function findWalletPassportDetail(
  db: D1Database,
  passportId: string,
  walletAddress: string,
): Promise<PassportDetailRecord | null> {
  const row = await db.prepare(`
    SELECT
      passports.id,
      passports.product_id,
      passports.product_version,
      passports.current_owner_address,
      passports.purchase_intent_id,
      passports.warranty_started_at,
      passports.warranty_expires_at,
      passports.head_event_hash,
      passports.status,
      products.title AS product_title,
      products.description,
      products.image_key,
      products.issuer_address,
      products.warranty_duration_days,
      products.warranty_summary,
      payment_intents.transaction_hash AS purchase_transaction_hash,
      payment_intents.confirmed_block_height AS purchase_block_height,
      payment_intents.confirmed_at AS purchase_confirmed_at,
      passport_events.created_at AS issued_at,
      CASE WHEN passports.current_owner_address = ? THEN 'current' ELSE 'former' END AS ownership
    FROM passports
    JOIN products ON products.id = passports.product_id
    JOIN payment_intents ON payment_intents.id = passports.purchase_intent_id
    JOIN passport_events ON passport_events.passport_id = passports.id AND passport_events.sequence = 1
    WHERE passports.id = ?
      AND (
        passports.current_owner_address = ?
        OR payment_intents.buyer_address = ?
        OR EXISTS (
          SELECT 1 FROM passport_events AS ownership_events
          WHERE ownership_events.passport_id = passports.id
            AND ownership_events.type = 'transferred'
            AND ownership_events.actor_address = ?
        )
      )
  `).bind(
    walletAddress,
    passportId,
    walletAddress,
    walletAddress,
    walletAddress,
  ).first<PassportDetailRow>()
  if (!row) return null
  return {
    currentOwnerAddress: row.current_owner_address,
    description: row.description,
    headEventHash: row.head_event_hash,
    id: row.id,
    imageKey: row.image_key,
    issuerAddress: row.issuer_address,
    issuedAt: row.issued_at,
    ownership: row.ownership,
    productId: row.product_id,
    productTitle: row.product_title,
    productVersion: row.product_version,
    purchaseBlockHeight: row.purchase_block_height,
    purchaseConfirmedAt: row.purchase_confirmed_at,
    purchaseIntentId: row.purchase_intent_id,
    purchaseTransactionHash: row.purchase_transaction_hash,
    status: row.status,
    warrantyDurationDays: row.warranty_duration_days,
    warrantyExpiresAt: row.warranty_expires_at,
    warrantyStartedAt: row.warranty_started_at,
    warrantySummary: row.warranty_summary,
  }
}

export async function listPassportEvents(db: D1Database, passportId: string): Promise<PassportEventRecord[]> {
  const result = await db.prepare(`
    SELECT sequence, type, previous_event_hash, event_hash, actor_address, created_at
    FROM passport_events WHERE passport_id = ? ORDER BY sequence
  `).bind(passportId).all<PassportEventRow>()
  return result.results.map((row) => ({
    actorAddress: row.actor_address,
    createdAt: row.created_at,
    eventHash: row.event_hash,
    previousEventHash: row.previous_event_hash,
    sequence: row.sequence,
    type: row.type,
  }))
}
