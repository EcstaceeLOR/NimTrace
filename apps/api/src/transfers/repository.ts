import type { TransferIntentResponse } from '@nimtrace/contracts'

export interface TransferIntentRecord {
  expiresAt: string
  fromAddress: string
  id: string
  ownerOfferPublicKey: string | null
  ownerOfferSignature: string
  passportId: string
  passportVersion: number
  priceLuna: 0
  recipientAcceptancePublicKey: string | null
  recipientAcceptanceSignature: string | null
  resultingEventId: string | null
  status: TransferIntentResponse['status']
  toAddress: string
}

export interface TransferPassportRecord {
  currentOwnerAddress: string
  headEventHash: string
  id: string
  productId: string
  productVersion: number
  status: 'active' | 'transfer_pending' | 'suspended' | 'retired'
  version: number
}

interface TransferPassportRow {
  current_owner_address: string
  head_event_hash: string
  id: string
  product_id: string
  product_version: number
  status: TransferPassportRecord['status']
  version: number
}

interface TransferIntentRow {
  expires_at: string
  from_address: string
  id: string
  owner_offer_public_key: string | null
  owner_offer_signature: string
  passport_id: string
  passport_version: number
  price_luna: 0
  recipient_acceptance_public_key: string | null
  recipient_acceptance_signature: string | null
  resulting_event_id: string | null
  status: TransferIntentRecord['status']
  to_address: string
}

function transfer(row: TransferIntentRow): TransferIntentRecord {
  return {
    expiresAt: row.expires_at,
    fromAddress: row.from_address,
    id: row.id,
    ownerOfferPublicKey: row.owner_offer_public_key,
    ownerOfferSignature: row.owner_offer_signature,
    passportId: row.passport_id,
    passportVersion: row.passport_version,
    priceLuna: 0,
    recipientAcceptancePublicKey: row.recipient_acceptance_public_key,
    recipientAcceptanceSignature: row.recipient_acceptance_signature,
    resultingEventId: row.resulting_event_id,
    status: row.status,
    toAddress: row.to_address,
  }
}

export async function findTransferIntent(db: D1Database, id: string) {
  const row = await db.prepare(`
    SELECT id, passport_id, from_address, to_address, price_luna, expires_at,
      owner_offer_signature, owner_offer_public_key, recipient_acceptance_signature,
      recipient_acceptance_public_key, passport_version, resulting_event_id, status
    FROM transfer_intents WHERE id = ?
  `).bind(id).first<TransferIntentRow>()
  return row ? transfer(row) : null
}

export async function findTransferPassport(db: D1Database, passportId: string) {
  const row = await db.prepare(`
    SELECT id, current_owner_address, head_event_hash, product_id, product_version,
      status, version
    FROM passports WHERE id = ?
  `).bind(passportId).first<TransferPassportRow>()
  return row ? {
    currentOwnerAddress: row.current_owner_address,
    headEventHash: row.head_event_hash,
    id: row.id,
    productId: row.product_id,
    productVersion: row.product_version,
    status: row.status,
    version: row.version,
  } satisfies TransferPassportRecord : null
}

export async function transferEventSequence(db: D1Database, passportId: string) {
  const row = await db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM passport_events WHERE passport_id = ?')
    .bind(passportId).first<{ sequence: number }>()
  return Number(row?.sequence ?? 0) + 1
}

export async function createCompletedTransfer(
  db: D1Database,
  input: {
    actorAddress: string
    actorPublicKey: string
    actorSignature: string
    canonicalPayload: string
    createdAt: string
    eventHash: string
    eventId: string
    payloadHash: string
    passportId: string
    previousEventHash: string
    sequence: number
    transferId: string
  },
) {
  await db.batch([
    db.prepare(`
      UPDATE passports SET current_owner_address = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND current_owner_address = (SELECT from_address FROM transfer_intents WHERE id = ?)
        AND version = (SELECT passport_version FROM transfer_intents WHERE id = ?)
        AND status = 'active'
        AND EXISTS (SELECT 1 FROM transfer_intents WHERE id = ? AND status = 'pending_recipient')
    `).bind(input.actorAddress, input.createdAt, input.passportId, input.transferId, input.transferId, input.transferId),
    db.prepare(`
      UPDATE transfer_intents SET status = 'accepted', recipient_acceptance_signature = ?,
        recipient_acceptance_public_key = ?, updated_at = ?
      WHERE id = ? AND status = 'pending_recipient' AND expires_at > ?
        AND EXISTS (
          SELECT 1 FROM passports
          WHERE passports.id = transfer_intents.passport_id
            AND passports.current_owner_address = transfer_intents.to_address
            AND passports.version = transfer_intents.passport_version + 1
        )
    `).bind(input.actorSignature, input.actorPublicKey, input.createdAt, input.transferId, input.createdAt),
    db.prepare(`
      INSERT INTO passport_events (
        id, passport_id, sequence, type, previous_event_hash, canonical_payload,
        payload_hash, event_hash, actor_address, actor_public_key, actor_signature
      )
      SELECT ?, ?, ?, 'transferred', ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM transfer_intents
        WHERE id = ? AND status = 'accepted'
      )
    `).bind(
      input.eventId,
      input.passportId,
      input.sequence,
      input.previousEventHash,
      input.canonicalPayload,
      input.payloadHash,
      input.eventHash,
      input.actorAddress,
      input.actorPublicKey,
      input.actorSignature,
      input.transferId,
    ),
    db.prepare(`
      UPDATE transfer_intents SET status = 'completed', resulting_event_id = ?, updated_at = ?
      WHERE id = ? AND status = 'accepted'
    `).bind(input.eventId, input.createdAt, input.transferId),
  ])
}
