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
  expirePaymentIntentIfUnpaid,
  findActiveInitialPurchaseIntent,
  findPaymentIntent,
  findPurchaseIntentByIdempotency,
  insertInitialPurchaseIntent,
  listReconcilablePaymentIntents,
  submitPaymentIntent,
  type StoredPaymentIntent,
} from './repository'
import type { NimiqRpcClient, NimiqRpcTransaction } from './rpc'
import {
  FINALITY_CONFIRMATIONS,
  INCLUSION_GRACE_MS,
  verifyStoredPaymentIntent,
} from './verification'

const PURCHASE_INTENT_TTL_MS = 10 * 60 * 1000
const PURCHASE_TAG_PREFIX = 'NTP1:'
const RECONCILIATION_HISTORY_LIMIT = 100
const RECONCILIATION_JOB_LIMIT = 20

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
  await expirePendingPurchaseIntents(
    db,
    productId,
    new Date(now.getTime() - INCLUSION_GRACE_MS).toISOString(),
    now.toISOString(),
  )

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
  rpc: Pick<NimiqRpcClient, 'getTransaction' | 'getTransactionsByAddress'>,
  now = new Date(),
): Promise<PaymentVerificationResponse> {
  const stored = await findPaymentIntent(db, intentId)
  if (!stored || stored.intent.buyerAddress !== buyerAddress) {
    return fail('payment_intent_not_found', 'This payment intent was not found.', 404)
  }

  return reconcileStoredPaymentIntent(db, stored, rpc, now)
}

function publicVerification(result: Awaited<ReturnType<typeof verifyStoredPaymentIntent>>) {
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

function pendingDiscoveryResponse(stored: StoredPaymentIntent, now: Date) {
  return PaymentVerificationResponseSchema.parse({
    blockHeight: null,
    checkedAt: now.toISOString(),
    confirmations: null,
    finalityConfirmations: FINALITY_CONFIRMATIONS,
    id: stored.intent.id,
    reason: 'transaction_not_found',
    state: 'pending',
    transactionHash: null,
  })
}

function transactionHash(transaction: NimiqRpcTransaction) {
  for (const name of ['hash', 'transactionHash', 'transaction_hash']) {
    const value = transaction[name]
    if (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)) return value
  }
  return undefined
}

async function settleSubmittedPayment(
  db: D1Database,
  stored: StoredPaymentIntent,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  now: Date,
): Promise<PaymentVerificationResponse> {
  const result = await verifyStoredPaymentIntent(stored, rpc, now)
  let settled = true
  if (result.state === 'verified'
    && stored.intent.status === 'submitted'
    && result.blockHeight !== null
    && result.chainTimestamp) {
    settled = await confirmPaymentIntent(
      db,
      stored.intent.id,
      stored.transactionHash!,
      result.blockHeight,
      result.chainTimestamp,
    )
  } else if (result.state === 'rejected' && stored.intent.status === 'submitted') {
    settled = await failPaymentIntent(db, stored.intent.id, `chain_${result.reason}`, now.toISOString())
  }

  if (!settled) {
    const concurrent = await findPaymentIntent(db, stored.intent.id)
    if (concurrent) return publicVerification(await verifyStoredPaymentIntent(concurrent, rpc, now))
  }
  return publicVerification(result)
}

async function discoverTaggedPayment(
  stored: StoredPaymentIntent,
  rpc: Pick<NimiqRpcClient, 'getTransactionsByAddress'>,
  now: Date,
) {
  const history = await rpc.getTransactionsByAddress(
    stored.intent.sellerAddress,
    RECONCILIATION_HISTORY_LIMIT,
  )
  if (history.status !== 'found') return history.status

  // RPC history is newest-first. Prefer the earliest valid matching payment if
  // a wallet managed to broadcast the same intent more than once.
  for (const transaction of [...history.transactions].reverse()) {
    const hash = transactionHash(transaction)
    if (!hash) continue
    const candidate: StoredPaymentIntent = {
      ...stored,
      intent: { ...stored.intent, status: 'submitted' },
      transactionHash: hash,
    }
    const verification = await verifyStoredPaymentIntent(candidate, {
      getTransaction: async () => ({ status: 'found', transaction }),
    }, now)
    if (verification.state === 'verified'
      || (verification.state === 'pending' && verification.reason === 'awaiting_finality')) {
      return { candidate, transaction }
    }
  }
  return 'not_found' as const
}

export async function reconcileStoredPaymentIntent(
  db: D1Database,
  stored: StoredPaymentIntent,
  rpc: Pick<NimiqRpcClient, 'getTransaction' | 'getTransactionsByAddress'>,
  now = new Date(),
): Promise<PaymentVerificationResponse> {
  if (stored.transactionHash || stored.intent.status !== 'pending') {
    return settleSubmittedPayment(db, stored, rpc, now)
  }

  const discovery = await discoverTaggedPayment(stored, rpc, now)
  if (typeof discovery === 'object') {
    try {
      const submitted = await submitPaymentIntent(
        db,
        stored.intent.id,
        stored.intent.buyerAddress,
        discovery.candidate.transactionHash!,
        now.toISOString(),
      )
      if (submitted) {
        const submittedIntent = await findPaymentIntent(db, stored.intent.id)
        if (submittedIntent) {
          return settleSubmittedPayment(db, submittedIntent, {
            getTransaction: async () => ({ status: 'found', transaction: discovery.transaction }),
          }, now)
        }
      }
    } catch {
      // A unique-hash race is resolved by re-reading the intent below.
    }
    const concurrent = await findPaymentIntent(db, stored.intent.id)
    if (concurrent?.transactionHash) return settleSubmittedPayment(db, concurrent, rpc, now)
  } else if (discovery === 'unavailable' || discovery === 'invalid') {
    return PaymentVerificationResponseSchema.parse({
      ...pendingDiscoveryResponse(stored, now),
      reason: discovery === 'invalid' ? 'provider_response_invalid' : 'provider_unavailable',
      state: 'inconclusive',
    })
  }

  const expiresBefore = new Date(now.getTime() - INCLUSION_GRACE_MS).toISOString()
  if (stored.intent.expiresAt <= expiresBefore) {
    await expirePaymentIntentIfUnpaid(db, stored.intent.id, expiresBefore, now.toISOString())
    const expired = await findPaymentIntent(db, stored.intent.id)
    if (expired?.intent.status === 'expired') {
      return settleSubmittedPayment(db, expired, rpc, now)
    }
  }
  return pendingDiscoveryResponse(stored, now)
}

export async function reconcilePaymentIntents(
  db: D1Database,
  network: NimiqNetwork,
  rpc: Pick<NimiqRpcClient, 'getTransaction' | 'getTransactionsByAddress'>,
  now = new Date(),
) {
  const intents = await listReconcilablePaymentIntents(db, network, RECONCILIATION_JOB_LIMIT)
  const summary = { checked: intents.length, inconclusive: 0, pending: 0, rejected: 0, verified: 0 }
  for (const intent of intents) {
    try {
      const result = await reconcileStoredPaymentIntent(db, intent, rpc, now)
      summary[result.state] += 1
    } catch {
      summary.inconclusive += 1
    }
  }
  return summary
}
