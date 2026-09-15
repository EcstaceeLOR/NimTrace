import {
  PaymentSubmissionResponseSchema,
  PaymentVerificationResponseSchema,
  PurchaseIntentResponseSchema,
  type NimiqNetwork,
  type PaymentSubmissionResponse,
  type PaymentVerificationResponse,
  type PurchaseIntentResponse,
} from '@nimtrace/contracts'
import { randomToken, sha256Hex } from '../auth/crypto'
import { getPublicProduct } from '../products/public'
import {
  expirePendingPurchaseIntents,
  confirmPaymentIntent,
  failPaymentIntent,
  findActiveInitialPurchaseIntent,
  findPaymentIntent,
  findPurchaseIntentByIdempotency,
  insertInitialPurchaseIntent,
  submitPaymentIntent,
} from './repository'
import type { NimiqRpcClient } from './rpc'
import { verifyStoredPaymentIntent } from './verification'

const PURCHASE_INTENT_TTL_MS = 10 * 60 * 1000
const PURCHASE_TAG_PREFIX = 'NTP1:'

export class PaymentIntentServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

function submissionResponse(
  id: string,
  status: 'submitted' | 'confirmed',
  transactionHash: string,
): PaymentSubmissionResponse {
  return PaymentSubmissionResponseSchema.parse({ id, status, transactionHash })
}

function fail(code: string, message: string, status: PaymentIntentServiceError['status']): never {
  throw new PaymentIntentServiceError(code, message, status)
}

function matchesProduct(intent: PurchaseIntentResponse, productId: string, version: number) {
  return intent.productId === productId && intent.productVersion === version
}

export async function createInitialPurchaseIntent(
  db: D1Database,
  productId: string,
  buyerAddress: string,
  idempotencyKey: string,
  network: NimiqNetwork,
  now = new Date(),
): Promise<{ created: boolean; intent: PurchaseIntentResponse }> {
  const idempotencyKeyHash = await sha256Hex(idempotencyKey)
  await expirePendingPurchaseIntents(db, productId, now.toISOString())

  const previous = await findPurchaseIntentByIdempotency(db, buyerAddress, idempotencyKeyHash)
  if (previous) {
    if (previous.productId !== productId) {
      return fail('idempotency_conflict', 'This idempotency key was already used for another request.', 409)
    }
    return { created: false, intent: previous }
  }

  const product = await getPublicProduct(db, productId, network)
  if (product.state !== 'available' || product.signatureState !== 'verified') {
    return fail('product_unavailable', 'This product is not available for purchase.', 409)
  }
  if (product.issuerAddress === buyerAddress) {
    return fail('buyer_is_seller', 'The issuer wallet cannot purchase its own product.', 400)
  }

  const active = await findActiveInitialPurchaseIntent(db, productId)
  if (active) {
    if (active.buyerAddress === buyerAddress && matchesProduct(active, productId, product.version)) {
      return { created: false, intent: active }
    }
    return fail('product_checkout_busy', 'Another checkout is already active for this product.', 409)
  }

  const id = randomToken(18)
  const transactionData = `${PURCHASE_TAG_PREFIX}${id}`
  if (new TextEncoder().encode(transactionData).byteLength > 64) {
    throw new Error('Purchase transaction tag exceeds the Nimiq data limit.')
  }
  const createdAt = now.toISOString()
  const intent = PurchaseIntentResponseSchema.parse({
    amountLuna: product.priceLuna,
    buyerAddress,
    createdAt,
    expiresAt: new Date(now.getTime() + PURCHASE_INTENT_TTL_MS).toISOString(),
    id,
    network,
    productId,
    productVersion: product.version,
    sellerAddress: product.issuerAddress,
    status: 'pending',
    transactionData,
  })

  try {
    await insertInitialPurchaseIntent(db, { ...intent, idempotencyKeyHash })
    return { created: true, intent }
  } catch (error) {
    const replay = await findPurchaseIntentByIdempotency(db, buyerAddress, idempotencyKeyHash)
    if (replay && replay.productId === productId) return { created: false, intent: replay }

    const winner = await findActiveInitialPurchaseIntent(db, productId)
    if (winner?.buyerAddress === buyerAddress && matchesProduct(winner, productId, product.version)) {
      return { created: false, intent: winner }
    }
    if (winner) return fail('product_checkout_busy', 'Another checkout is already active for this product.', 409)
    throw error
  }
}

export async function recordPaymentSubmission(
  db: D1Database,
  intentId: string,
  buyerAddress: string,
  transactionHash: string,
  now = new Date(),
): Promise<PaymentSubmissionResponse> {
  let stored = await findPaymentIntent(db, intentId)
  if (!stored || stored.intent.buyerAddress !== buyerAddress) {
    return fail('payment_intent_not_found', 'This payment intent was not found.', 404)
  }

  if (stored.intent.status === 'submitted' || stored.intent.status === 'confirmed') {
    if (stored.transactionHash !== transactionHash) {
      return fail('transaction_hash_conflict', 'This intent already has a different transaction hash.', 409)
    }
    return submissionResponse(intentId, stored.intent.status, transactionHash)
  }

  if (stored.intent.status !== 'pending') {
    return fail('payment_intent_not_pending', 'This payment intent can no longer accept a transaction.', 409)
  }

  try {
    if (await submitPaymentIntent(db, intentId, buyerAddress, transactionHash, now.toISOString())) {
      return submissionResponse(intentId, 'submitted', transactionHash)
    }
  } catch (error) {
    if (error instanceof Error && /transaction_hash/i.test(error.message)) {
      return fail('transaction_hash_conflict', 'This transaction is already linked to another intent.', 409)
    }
    throw error
  }

  stored = await findPaymentIntent(db, intentId)
  if (stored?.transactionHash === transactionHash
    && (stored.intent.status === 'submitted' || stored.intent.status === 'confirmed')) {
    return submissionResponse(intentId, stored.intent.status, transactionHash)
  }
  return fail('payment_submission_conflict', 'The payment intent changed before submission was saved.', 409)
}

export async function verifyPaymentIntent(
  db: D1Database,
  intentId: string,
  buyerAddress: string,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  now = new Date(),
): Promise<PaymentVerificationResponse> {
  let stored = await findPaymentIntent(db, intentId)
  if (!stored || stored.intent.buyerAddress !== buyerAddress) {
    return fail('payment_intent_not_found', 'This payment intent was not found.', 404)
  }

  const result = await verifyStoredPaymentIntent(stored, rpc, now)
  let settled = true
  if (result.state === 'verified'
    && stored.intent.status === 'submitted'
    && result.blockHeight !== null
    && result.chainTimestamp) {
    settled = await confirmPaymentIntent(
      db,
      intentId,
      stored.transactionHash!,
      result.blockHeight,
      result.chainTimestamp,
    )
  } else if (result.state === 'rejected' && stored.intent.status === 'submitted') {
    settled = await failPaymentIntent(db, intentId, `chain_${result.reason}`, now.toISOString())
  }

  if (!settled) {
    // A concurrent verifier may have settled the same row first. Returning the
    // recomputed stored result keeps repeated status checks idempotent.
    stored = await findPaymentIntent(db, intentId)
    if (stored) return PaymentVerificationResponseSchema.parse(await verifyStoredPaymentIntent(stored, rpc, now))
  }
  return PaymentVerificationResponseSchema.parse({
    blockHeight: result.blockHeight,
    checkedAt: result.checkedAt,
    confirmations: result.confirmations,
    finalityConfirmations: result.finalityConfirmations,
    id: result.id,
    reason: result.reason,
    state: result.state,
    transactionHash: result.transactionHash,
  })
}
