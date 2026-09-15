import {
  TransferIntentResponseSchema,
  TransferOfferPayloadSchema,
  TransferProofChallengeResponseSchema,
  canonicalJson,
  canonicalPayload,
  createProofEnvelope,
  hashCanonicalPayload,
  proofSigningMessage,
  sha256Hex,
  type NimiqNetwork,
  type SignedProof,
  type TransferIntentResponse,
  type TransferOfferPayload,
} from '@nimtrace/contracts'
import { normalizeNimiqAddress, randomToken } from '../auth/crypto'
import { findProofNonce, insertProofNonce } from '../products/repository'
import { confirmPaymentIntent, findPaymentIntent } from '../payments/repository'
import { verifyStoredPaymentIntent } from '../payments/verification'
import type { NimiqRpcClient } from '../payments/rpc'
import { verifySignedProof } from '../proofs/verifier'
import {
  createCompletedTransfer,
  findTransferIntent,
  findTransferPassport,
  recordAcceptedTransfer,
  transferEventSequence,
} from './repository'

const TRANSFER_TTL_MS = 15 * 60 * 1000

export class TransferServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404 | 409 | 410) {
    super(message)
  }
}

function fail(code: string, message: string, status: TransferServiceError['status']): never {
  throw new TransferServiceError(code, message, status)
}

function response(intent: Awaited<ReturnType<typeof findTransferIntent>>): TransferIntentResponse {
  if (!intent) throw new TransferServiceError('transfer_not_found', 'Transfer offer not found.', 404)
  return TransferIntentResponseSchema.parse({
    expiresAt: intent.expiresAt,
    fromAddress: intent.fromAddress,
    id: intent.id,
    passportId: intent.passportId,
    paymentIntentId: intent.paymentIntentId,
    priceLuna: intent.priceLuna,
    status: intent.status,
    toAddress: intent.toAddress,
    transactionData: intent.transactionData,
    version: intent.passportVersion,
  })
}

async function signedTransferChallenge(
  db: D1Database,
  input: { action: 'OFFER_TRANSFER' | 'ACCEPT_TRANSFER'; address: string; intentId: string; passportId: string; payload: TransferOfferPayload; previousEventHash: string | null; network: NimiqNetwork; now: Date },
) {
  const envelope = createProofEnvelope({
    action: input.action,
    expiresAt: input.payload.expiresAt,
    issuedAt: input.now.toISOString(),
    network: input.network,
    nonce: input.intentId,
    payloadHash: await hashCanonicalPayload(input.payload),
    previousEventHash: input.previousEventHash,
    summary: input.action === 'OFFER_TRANSFER'
      ? `Gift passport ${input.passportId} to ${input.payload.recipientAddress}.`
      : `Accept gift passport ${input.passportId} from ${input.payload.recipientAddress}.`,
  })
  await insertProofNonce(db, {
    action: envelope.action,
    consumed_at: null,
    expires_at: envelope.expiresAt,
    id: input.intentId,
    payload_hash: envelope.payloadHash,
    resource_id: input.action === 'OFFER_TRANSFER' ? input.passportId : input.payload.nonce,
    wallet_address: input.address,
  }, input.now.toISOString())
  return TransferProofChallengeResponseSchema.parse({
    envelope,
    intentId: input.intentId,
    message: proofSigningMessage(envelope),
    payload: input.payload,
  })
}

export async function createTransferOfferChallenge(
  db: D1Database,
  passportId: string,
  ownerAddress: string,
  recipientAddress: string,
  network: NimiqNetwork,
  priceLuna = 0,
  now = new Date(),
) {
  const passport = await findTransferPassport(db, passportId)
  if (!passport) return fail('passport_not_found', 'Passport not found.', 404)
  if (passport.currentOwnerAddress !== ownerAddress || passport.status !== 'active') {
    return fail('not_current_owner', 'Only the current owner can create a transfer offer.', 409)
  }
  let recipient: string
  try { recipient = normalizeNimiqAddress(recipientAddress) } catch { return fail('invalid_recipient', 'Recipient wallet address is invalid.', 400) }
  if (recipient === ownerAddress) return fail('invalid_recipient', 'Recipient must be a different wallet.', 400)
  const intentId = randomToken(18)
  const payload = TransferOfferPayloadSchema.parse({
    expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS).toISOString(),
    nonce: intentId,
    passportId,
    priceLuna,
    recipientAddress: recipient,
    version: passport.version,
  })
  return signedTransferChallenge(db, {
    action: 'OFFER_TRANSFER', address: ownerAddress, intentId, passportId, payload,
    previousEventHash: passport.headEventHash, network, now,
  })
}

export async function submitTransferOffer(
  db: D1Database,
  passportId: string,
  ownerAddress: string,
  proof: SignedProof,
  network: NimiqNetwork,
  now = new Date(),
) {
  const payload = TransferOfferPayloadSchema.safeParse(proof.payload)
  if (!payload.success || payload.data.passportId !== passportId) return fail('invalid_offer', 'The signed offer does not match this passport.', 400)
  const nonce = await findProofNonce(db, proof.envelope.nonce)
  if (!nonce || nonce.action !== 'OFFER_TRANSFER' || nonce.resource_id !== passportId || nonce.wallet_address !== ownerAddress) return fail('offer_not_found', 'This transfer offer has expired or was not issued for this wallet.', 409)
  if (nonce.consumed_at) return fail('offer_replayed', 'This transfer offer was already submitted.', 409)
  const passport = await findTransferPassport(db, passportId)
  if (!passport || passport.currentOwnerAddress !== ownerAddress || passport.version !== payload.data.version) return fail('stale_owner', 'The passport changed before this offer was signed.', 409)
  const verification = await verifySignedProof(proof, {
    action: 'OFFER_TRANSFER', network, nonce: proof.envelope.nonce,
    now, previousEventHash: passport.headEventHash, signerAddress: ownerAddress,
  })
  if (!verification.ok || nonce.payload_hash !== proof.envelope.payloadHash) return fail('invalid_offer_signature', 'The owner signature could not be verified.', 400)
  try {
    const paymentIntentId = payload.data.priceLuna > 0 ? randomToken(18) : null
    const transactionData = paymentIntentId ? `NTR2:${paymentIntentId}` : null
    const statements = []
    if (paymentIntentId) statements.push(db.prepare(`
      INSERT INTO payment_intents (
        id, purpose, product_id, passport_id, product_version, seller_address, buyer_address,
        amount_luna, network, transaction_data, expires_at, status, created_at, updated_at
      ) VALUES (?, 'resale', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      paymentIntentId, passport.productId, passportId, passport.productVersion,
      ownerAddress, payload.data.recipientAddress, payload.data.priceLuna, network,
      transactionData, payload.data.expiresAt, now.toISOString(), now.toISOString(),
    ))
    statements.push(db.prepare(`
      INSERT INTO transfer_intents (
        id, passport_id, from_address, to_address, price_luna, expires_at,
        owner_offer_signature, owner_offer_public_key, passport_version, payment_intent_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_recipient', ?, ?)
    `).bind(
      proof.envelope.nonce, passportId, ownerAddress, payload.data.recipientAddress,
      payload.data.priceLuna, payload.data.expiresAt, proof.signature, proof.publicKey,
      payload.data.version, paymentIntentId, now.toISOString(), now.toISOString(),
    ))
    await db.batch(statements)
  } catch (error) {
    if (error instanceof Error && /one_active_per_passport|UNIQUE/i.test(error.message)) return fail('transfer_in_progress', 'This passport already has an active transfer offer.', 409)
    throw error
  }
  return response(await findTransferIntent(db, proof.envelope.nonce))
}

export async function createAcceptanceChallenge(
  db: D1Database,
  intentId: string,
  recipientAddress: string,
  network: NimiqNetwork,
  now = new Date(),
) {
  const intent = await findTransferIntent(db, intentId)
  if (!intent) return fail('transfer_not_found', 'Transfer offer not found.', 404)
  if (intent.toAddress !== recipientAddress) return fail('wrong_recipient', 'This offer is bound to another wallet.', 409)
  if (intent.status !== 'pending_recipient') return fail('transfer_unavailable', 'This transfer is no longer available.', 409)
  if (Date.parse(intent.expiresAt) <= now.getTime()) return fail('transfer_expired', 'This transfer offer expired.', 410)
  const passport = await findTransferPassport(db, intent.passportId)
  if (!passport || passport.version !== intent.passportVersion || passport.currentOwnerAddress !== intent.fromAddress) return fail('stale_owner', 'The passport owner changed before acceptance.', 409)
  const acceptanceNonce = randomToken(18)
  const payload = TransferOfferPayloadSchema.parse({
    expiresAt: intent.expiresAt,
    nonce: intent.id,
    passportId: intent.passportId,
    priceLuna: intent.priceLuna,
    recipientAddress: intent.toAddress,
    version: intent.passportVersion,
  })
  return signedTransferChallenge(db, {
    action: 'ACCEPT_TRANSFER', address: recipientAddress, intentId: acceptanceNonce,
    passportId: intent.passportId, payload, previousEventHash: passport.headEventHash,
    network, now,
  })
}

export async function acceptTransfer(
  db: D1Database,
  intentId: string,
  recipientAddress: string,
  proof: SignedProof,
  network: NimiqNetwork,
  now = new Date(),
) {
  const intent = await findTransferIntent(db, intentId)
  if (!intent) return fail('transfer_not_found', 'Transfer offer not found.', 404)
  if (intent.toAddress !== recipientAddress) return fail('wrong_recipient', 'This offer is bound to another wallet.', 409)
  if (intent.status !== 'pending_recipient') return fail('transfer_unavailable', 'This transfer is no longer available.', 409)
  if (Date.parse(intent.expiresAt) <= now.getTime()) return fail('transfer_expired', 'This transfer offer expired.', 410)
  const payload = TransferOfferPayloadSchema.safeParse(proof.payload)
  if (!payload.success || payload.data.passportId !== intent.passportId || payload.data.nonce !== intent.id || payload.data.recipientAddress !== recipientAddress || payload.data.version !== intent.passportVersion) return fail('invalid_acceptance', 'The recipient signature does not match this offer.', 400)
  const passport = await findTransferPassport(db, intent.passportId)
  if (!passport || passport.version !== intent.passportVersion || passport.currentOwnerAddress !== intent.fromAddress) return fail('stale_owner', 'The passport owner changed before acceptance.', 409)
  const nonce = await findProofNonce(db, proof.envelope.nonce)
  if (!nonce || nonce.action !== 'ACCEPT_TRANSFER' || nonce.resource_id !== intentId || nonce.wallet_address !== recipientAddress || nonce.consumed_at) return fail('acceptance_not_found', 'This acceptance request is invalid or already used.', 409)
  const verification = await verifySignedProof(proof, {
    action: 'ACCEPT_TRANSFER', network, nonce: proof.envelope.nonce,
    now, previousEventHash: passport.headEventHash, signerAddress: recipientAddress,
  })
  if (!verification.ok || nonce.payload_hash !== proof.envelope.payloadHash) return fail('invalid_acceptance_signature', 'The recipient signature could not be verified.', 400)
  const accepted = await recordAcceptedTransfer(db, {
    intentId,
    publicKey: proof.publicKey,
    signature: proof.signature,
    updatedAt: now.toISOString(),
  })
  if (!accepted) return fail('transfer_conflict', 'The transfer changed before acceptance was saved.', 409)
  if (intent.priceLuna > 0) return response(await findTransferIntent(db, intentId))
  const sequence = await transferEventSequence(db, intent.passportId)
  const eventId = randomToken(18)
  const eventPayload = {
    eventType: 'transferred',
    expiresAt: intent.expiresAt,
    fromAddress: intent.fromAddress,
    passportId: intent.passportId,
    toAddress: recipientAddress,
    transferIntentId: intent.id,
    version: intent.passportVersion,
  }
  const canonical = canonicalPayload(eventPayload)
  const payloadHash = await sha256Hex(canonical)
  const eventHash = await sha256Hex(canonicalJson({
    passportId: intent.passportId,
    payloadHash,
    previousEventHash: passport.headEventHash,
    sequence,
    type: 'transferred',
    version: 1,
  }))
  await createCompletedTransfer(db, {
    actorAddress: recipientAddress,
    actorPublicKey: proof.publicKey,
    actorSignature: proof.signature,
    canonicalPayload: canonical,
    createdAt: now.toISOString(),
    eventHash,
    eventId,
    payloadHash,
    passportId: intent.passportId,
    previousEventHash: passport.headEventHash,
    sequence,
    transferId: intent.id,
  })
  const completed = await findTransferIntent(db, intent.id)
  if (!completed || completed.status !== 'completed' || completed.resultingEventId !== eventId) return fail('transfer_conflict', 'The passport changed before transfer completion.', 409)
  return response(completed)
}

export async function getTransferIntent(db: D1Database, id: string): Promise<TransferIntentResponse> {
  return response(await findTransferIntent(db, id))
}

export async function completePaidTransfer(
  db: D1Database,
  intentId: string,
  recipientAddress: string,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  now = new Date(),
) {
  const intent = await findTransferIntent(db, intentId)
  if (!intent || intent.toAddress !== recipientAddress) return fail('transfer_not_found', 'Transfer offer not found.', 404)
  if (intent.status !== 'accepted' || !intent.paymentIntentId) return fail('payment_not_ready', 'Recipient acceptance must be recorded before payment completion.', 409)
  const payment = await findPaymentIntent(db, intent.paymentIntentId)
  if (!payment) return fail('payment_not_found', 'Resale payment intent not found.', 409)
  const verification = await verifyStoredPaymentIntent(payment, rpc, now)
  if (verification.state !== 'verified') return fail(`payment_${verification.state}`, `Payment is not final yet (${verification.reason}).`, 409)
  if (payment.intent.status === 'submitted' && verification.blockHeight !== null && verification.chainTimestamp) {
    await confirmPaymentIntent(db, payment.intent.id, payment.transactionHash!, verification.blockHeight, verification.chainTimestamp)
  }
  const passport = await findTransferPassport(db, intent.passportId)
  if (!passport || passport.currentOwnerAddress !== intent.fromAddress || passport.version !== intent.passportVersion) return fail('stale_owner', 'The passport owner changed before payment completion.', 409)
  const sequence = await transferEventSequence(db, intent.passportId)
  const eventId = randomToken(18)
  const eventPayload = {
    eventType: 'transferred',
    expiresAt: intent.expiresAt,
    fromAddress: intent.fromAddress,
    passportId: intent.passportId,
    priceLuna: intent.priceLuna,
    toAddress: intent.toAddress,
    transferIntentId: intent.id,
    version: intent.passportVersion,
  }
  const canonical = canonicalPayload(eventPayload)
  const payloadHash = await sha256Hex(canonical)
  const eventHash = await sha256Hex(canonicalJson({
    passportId: intent.passportId,
    payloadHash,
    previousEventHash: passport.headEventHash,
    sequence,
    type: 'transferred',
    version: 1,
  }))
  await createCompletedTransfer(db, {
    actorAddress: intent.toAddress,
    actorPublicKey: intent.recipientAcceptancePublicKey!,
    actorSignature: intent.recipientAcceptanceSignature!,
    canonicalPayload: canonical,
    createdAt: now.toISOString(),
    eventHash,
    eventId,
    payloadHash,
    passportId: intent.passportId,
    previousEventHash: passport.headEventHash,
    sequence,
    transferId: intent.id,
  })
  return response(await findTransferIntent(db, intentId))
}
