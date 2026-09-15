import {
  RepairAttestationPayloadSchema,
  canonicalJson,
  canonicalPayload,
  createProofEnvelope,
  hashCanonicalPayload,
  proofSigningMessage,
  sha256Hex,
  type NimiqNetwork,
  type SignedProof,
} from '@nimtrace/contracts'
import { normalizeNimiqAddress, randomToken } from '../auth/crypto'
import { findProofNonce, insertProofNonce } from '../products/repository'
import { verifySignedProof } from '../proofs/verifier'
import { findTransferPassport } from '../transfers/repository'

const REPAIR_TTL_MS = 15 * 60 * 1000
export class RepairServiceError extends Error { constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 | 410) { super(message) } }
function fail(code: string, message: string, status: RepairServiceError['status']): never { throw new RepairServiceError(code, message, status) }

interface RepairRow { id: string; passport_id: string; repairer_address: string; service_type: string; notes: string; serviced_at: string; expires_at: string; previous_event_hash: string; repairer_public_key: string; repairer_signature: string; owner_address: string | null; owner_public_key: string | null; owner_signature: string | null; status: 'pending_owner' | 'acknowledged' | 'rejected' }
async function repairRow(db: D1Database, id: string) {
  return db.prepare(`SELECT id, passport_id, repairer_address, service_type, notes, serviced_at, expires_at, previous_event_hash, repairer_public_key, repairer_signature, owner_address, owner_public_key, owner_signature, status FROM repair_attestations WHERE id = ?`).bind(id).first<RepairRow>()
}

export async function createRepairChallenge(db: D1Database, passportId: string, ownerAddress: string, repairerAddress: string, input: { serviceType: string; notes: string; servicedAt: string }, network: NimiqNetwork, now = new Date()) {
  const passport = await findTransferPassport(db, passportId)
  if (!passport || passport.currentOwnerAddress !== ownerAddress) return fail('not_current_owner', 'Only the current owner can invite a repairer.', 409)
  let repairer: string; try { repairer = normalizeNimiqAddress(repairerAddress) } catch { return fail('invalid_repairer', 'Repairer wallet address is invalid.', 400) }
  const id = randomToken(18); const expiresAt = new Date(now.getTime() + REPAIR_TTL_MS).toISOString()
  const payload = RepairAttestationPayloadSchema.parse({ expiresAt, notes: input.notes, nonce: id, passportId, previousEventHash: passport.headEventHash, repairerAddress: repairer, serviceType: input.serviceType, servicedAt: input.servicedAt })
  const envelope = createProofEnvelope({ action: 'ATTEST_REPAIR', expiresAt, issuedAt: now.toISOString(), network, nonce: id, payloadHash: await hashCanonicalPayload(payload), previousEventHash: passport.headEventHash, summary: `Record ${input.serviceType} service for passport ${passportId}.` })
  await insertProofNonce(db, { action: 'ATTEST_REPAIR', consumed_at: null, expires_at: expiresAt, id, payload_hash: envelope.payloadHash, resource_id: passportId, wallet_address: repairer }, now.toISOString())
  return { envelope, message: proofSigningMessage(envelope), payload, repairId: id }
}

export async function submitRepair(db: D1Database, passportId: string, proof: SignedProof, network: NimiqNetwork, now = new Date()) {
  const payload = RepairAttestationPayloadSchema.safeParse(proof.payload); if (!payload.success || payload.data.passportId !== passportId) return fail('invalid_repair', 'Repair proof does not match this passport.', 400)
  const nonce = await findProofNonce(db, proof.envelope.nonce); if (!nonce || nonce.action !== 'ATTEST_REPAIR' || nonce.resource_id !== passportId || nonce.consumed_at) return fail('repair_not_found', 'Repair invitation is expired or already used.', 409)
  const passport = await findTransferPassport(db, passportId); if (!passport || passport.headEventHash !== payload.data.previousEventHash) return fail('stale_event_head', 'Passport history changed before repair signing.', 409)
  const verified = await verifySignedProof(proof, { action: 'ATTEST_REPAIR', network, nonce: proof.envelope.nonce, now, previousEventHash: passport.headEventHash, signerAddress: payload.data.repairerAddress })
  if (!verified.ok) return fail('invalid_repair_signature', 'Repairer signature could not be verified.', 400)
  await db.prepare(`INSERT INTO repair_attestations (id, passport_id, repairer_address, service_type, notes, serviced_at, expires_at, canonical_payload, payload_hash, repairer_public_key, repairer_signature, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_owner', ?, ?)`).bind(proof.envelope.nonce, passportId, payload.data.repairerAddress, payload.data.serviceType, payload.data.notes, payload.data.servicedAt, payload.data.expiresAt, verified.canonicalPayload, proof.envelope.payloadHash, proof.publicKey, proof.signature, now.toISOString(), now.toISOString()).run()
  return { repairId: proof.envelope.nonce, status: 'pending_owner' as const }
}

export async function createRepairAcknowledgement(db: D1Database, repairId: string, ownerAddress: string, network: NimiqNetwork, now = new Date()) {
  const row = await repairRow(db, repairId); if (!row || row.owner_address || row.status !== 'pending_owner') return fail('repair_unavailable', 'Repair is unavailable for acknowledgement.', 409)
  const passport = await findTransferPassport(db, String(row.passport_id)); if (!passport || passport.currentOwnerAddress !== ownerAddress || passport.headEventHash !== row.previous_event_hash) return fail('stale_event_head', 'Passport history changed before acknowledgement.', 409)
  const nonce = randomToken(18); const payload = RepairAttestationPayloadSchema.parse({ expiresAt: row.expires_at, notes: row.notes, nonce: repairId, passportId: row.passport_id, previousEventHash: row.previous_event_hash, repairerAddress: row.repairer_address, serviceType: row.service_type, servicedAt: row.serviced_at })
  const envelope = createProofEnvelope({ action: 'ACKNOWLEDGE_REPAIR', expiresAt: row.expires_at, issuedAt: now.toISOString(), network, nonce, payloadHash: await hashCanonicalPayload(payload), previousEventHash: passport.headEventHash, summary: `Acknowledge repairer attestation for passport ${row.passport_id}.` })
  await insertProofNonce(db, { action: 'ACKNOWLEDGE_REPAIR', consumed_at: null, expires_at: row.expires_at, id: nonce, payload_hash: envelope.payloadHash, resource_id: repairId, wallet_address: ownerAddress }, now.toISOString())
  return { envelope, message: proofSigningMessage(envelope), payload, repairId }
}

export async function acknowledgeRepair(db: D1Database, repairId: string, ownerAddress: string, proof: SignedProof, network: NimiqNetwork, now = new Date()) {
  const row = await repairRow(db, repairId); if (!row || row.status !== 'pending_owner') return fail('repair_unavailable', 'Repair is unavailable for acknowledgement.', 409)
  const payload = RepairAttestationPayloadSchema.safeParse(proof.payload); if (!payload.success || payload.data.nonce !== repairId) return fail('invalid_acknowledgement', 'Acknowledgement does not match the repair.', 400)
  const passport = await findTransferPassport(db, String(row.passport_id)); if (!passport || passport.currentOwnerAddress !== ownerAddress || passport.headEventHash !== row.previous_event_hash) return fail('stale_event_head', 'Passport history changed before acknowledgement.', 409)
  const nonce = await findProofNonce(db, proof.envelope.nonce); if (!nonce || nonce.resource_id !== repairId || nonce.consumed_at) return fail('acknowledgement_not_found', 'Acknowledgement request is invalid or replayed.', 409)
  const verified = await verifySignedProof(proof, { action: 'ACKNOWLEDGE_REPAIR', network, nonce: proof.envelope.nonce, now, previousEventHash: passport.headEventHash, signerAddress: ownerAddress }); if (!verified.ok) return fail('invalid_acknowledgement_signature', 'Owner acknowledgement could not be verified.', 400)
  const eventId = randomToken(18); const sequenceRow = await db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM passport_events WHERE passport_id = ?').bind(row.passport_id).first<{ sequence: number }>(); const sequence = Number(sequenceRow?.sequence ?? 0) + 1
  const eventPayload = { eventType: 'repaired', passportId: row.passport_id, repairId, repairerAddress: row.repairer_address, serviceType: row.service_type, servicedAt: row.serviced_at, previousEventHash: row.previous_event_hash }
  const canonical = canonicalPayload(eventPayload); const payloadHash = await sha256Hex(canonical); const eventHash = await sha256Hex(canonicalJson({ passportId: row.passport_id, payloadHash, previousEventHash: row.previous_event_hash, sequence, type: 'repaired', version: 1 }))
  await db.batch([
    db.prepare(`INSERT INTO passport_events (id, passport_id, sequence, type, previous_event_hash, canonical_payload, payload_hash, event_hash, actor_address, actor_public_key, actor_signature) VALUES (?, ?, ?, 'repaired', ?, ?, ?, ?, ?, ?, ?)`).bind(eventId, row.passport_id, sequence, row.previous_event_hash, canonical, payloadHash, eventHash, ownerAddress, proof.publicKey, proof.signature),
    db.prepare(`UPDATE repair_attestations SET owner_address = ?, owner_public_key = ?, owner_signature = ?, status = 'acknowledged', resulting_event_id = ?, updated_at = ? WHERE id = ? AND status = 'pending_owner'`).bind(ownerAddress, proof.publicKey, proof.signature, eventId, now.toISOString(), repairId),
  ])
  return { eventHash, repairId, status: 'acknowledged' as const }
}
