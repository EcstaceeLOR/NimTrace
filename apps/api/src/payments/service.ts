import {
  PurchaseIntentResponseSchema,
  type NimiqNetwork,
  type PurchaseIntentResponse,
} from '@nimtrace/contracts'
import { randomToken, sha256Hex } from '../auth/crypto'
import { getPublicProduct } from '../products/public'
import {
  expirePendingPurchaseIntents,
  findActiveInitialPurchaseIntent,
  findPurchaseIntentByIdempotency,
  insertInitialPurchaseIntent,
} from './repository'

const PURCHASE_INTENT_TTL_MS = 10 * 60 * 1000
const PURCHASE_TAG_PREFIX = 'NTP1:'

export class PaymentIntentServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message)
  }
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
