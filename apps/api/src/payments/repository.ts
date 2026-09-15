import type {
  NimiqNetwork,
  PaymentIntentStatus,
  PurchaseIntentResponse,
} from '@nimtrace/contracts'

interface PaymentIntentRow {
  amount_luna: number
  buyer_address: string
  confirmed_at: string | null
  confirmed_block_height: number | null
  created_at: string
  expires_at: string
  failure_code: string | null
  id: string
  idempotency_key_hash: string | null
  network: NimiqNetwork
  product_id: string
  product_version: number
  purpose: 'initial_purchase' | 'resale'
  seller_address: string
  status: PaymentIntentStatus
  transaction_data: string
  transaction_hash: string | null
  updated_at: string
}

const intentProjection = `
  id, purpose, product_id, product_version, seller_address, buyer_address,
  amount_luna, network, transaction_data, expires_at, status,
  transaction_hash, confirmed_block_height, confirmed_at, failure_code,
  idempotency_key_hash, created_at, updated_at
`

function toPurchaseIntent(row: PaymentIntentRow): PurchaseIntentResponse {
  return {
    amountLuna: row.amount_luna,
    buyerAddress: row.buyer_address,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    network: row.network,
    productId: row.product_id,
    productVersion: row.product_version,
    sellerAddress: row.seller_address,
    status: row.status,
    transactionData: row.transaction_data,
  }
}

function toStoredPaymentIntent(row: PaymentIntentRow): StoredPaymentIntent {
  return {
    confirmedAt: row.confirmed_at,
    confirmedBlockHeight: row.confirmed_block_height,
    failureCode: row.failure_code,
    intent: toPurchaseIntent(row),
    transactionHash: row.transaction_hash,
  }
}

export interface StoredPaymentIntent {
  confirmedAt: string | null
  confirmedBlockHeight: number | null
  failureCode: string | null
  intent: PurchaseIntentResponse
  transactionHash: string | null
}

export async function findPaymentIntent(
  db: D1Database,
  intentId: string,
): Promise<StoredPaymentIntent | null> {
  const row = await db.prepare(`
    SELECT ${intentProjection}
    FROM payment_intents
    WHERE id = ?
  `).bind(intentId).first<PaymentIntentRow>()
  return row ? toStoredPaymentIntent(row) : null
}

export async function listReconcilablePaymentIntents(
  db: D1Database,
  network: NimiqNetwork,
  limit: number,
): Promise<StoredPaymentIntent[]> {
  const result = await db.prepare(`
    SELECT ${intentProjection}
    FROM payment_intents
    WHERE network = ? AND status IN ('pending', 'submitted')
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(network, limit).all<PaymentIntentRow>()
  return result.results.map(toStoredPaymentIntent)
}

export async function findPurchaseIntentByIdempotency(
  db: D1Database,
  buyerAddress: string,
  idempotencyKeyHash: string,
): Promise<PurchaseIntentResponse | null> {
  const row = await db.prepare(`
    SELECT ${intentProjection}
    FROM payment_intents
    WHERE buyer_address = ? AND idempotency_key_hash = ?
  `).bind(buyerAddress, idempotencyKeyHash).first<PaymentIntentRow>()
  return row ? toPurchaseIntent(row) : null
}

export async function findActiveInitialPurchaseIntent(
  db: D1Database,
  productId: string,
): Promise<PurchaseIntentResponse | null> {
  const row = await db.prepare(`
    SELECT ${intentProjection}
    FROM payment_intents
    WHERE product_id = ? AND purpose = 'initial_purchase'
      AND status IN ('pending', 'submitted', 'confirmed')
    LIMIT 1
  `).bind(productId).first<PaymentIntentRow>()
  return row ? toPurchaseIntent(row) : null
}

interface InsertPurchaseIntentInput extends PurchaseIntentResponse {
  idempotencyKeyHash: string
}

export async function insertInitialPurchaseIntent(
  db: D1Database,
  input: InsertPurchaseIntentInput,
): Promise<void> {
  await db.prepare(`
    INSERT INTO payment_intents (
      id, purpose, product_id, product_version, seller_address, buyer_address,
      amount_luna, network, transaction_data, expires_at, status,
      idempotency_key_hash, created_at, updated_at
    ) VALUES (?, 'initial_purchase', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(
    input.id,
    input.productId,
    input.productVersion,
    input.sellerAddress,
    input.buyerAddress,
    input.amountLuna,
    input.network,
    input.transactionData,
    input.expiresAt,
    input.idempotencyKeyHash,
    input.createdAt,
    input.createdAt,
  ).run()
}

export async function expirePendingPurchaseIntents(
  db: D1Database,
  productId: string,
  expiresBefore: string,
  updatedAt = expiresBefore,
): Promise<void> {
  await db.prepare(`
    UPDATE payment_intents
    SET status = 'expired', updated_at = ?
    WHERE product_id = ? AND purpose = 'initial_purchase'
      AND status = 'pending' AND transaction_hash IS NULL AND expires_at <= ?
  `).bind(updatedAt, productId, expiresBefore).run()
}

export async function expirePaymentIntentIfUnpaid(
  db: D1Database,
  intentId: string,
  expiresBefore: string,
  updatedAt: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE payment_intents
    SET status = 'expired', updated_at = ?
    WHERE id = ? AND status = 'pending' AND transaction_hash IS NULL
      AND expires_at <= ?
  `).bind(updatedAt, intentId, expiresBefore).run()
  return (result.meta.changes ?? 0) === 1
}

export async function submitPaymentIntent(
  db: D1Database,
  intentId: string,
  buyerAddress: string,
  transactionHash: string,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE payment_intents
    SET status = 'submitted', transaction_hash = ?, updated_at = ?
    WHERE id = ? AND buyer_address = ? AND status = 'pending'
  `).bind(transactionHash, now, intentId, buyerAddress).run()
  return (result.meta.changes ?? 0) === 1
}

export async function confirmPaymentIntent(
  db: D1Database,
  intentId: string,
  transactionHash: string,
  confirmedBlockHeight: number,
  confirmedAt: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE payment_intents
    SET status = 'confirmed', confirmed_block_height = ?, confirmed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'submitted' AND transaction_hash = ?
  `).bind(
    confirmedBlockHeight,
    confirmedAt,
    confirmedAt,
    intentId,
    transactionHash,
  ).run()
  return (result.meta.changes ?? 0) === 1
}

export async function failPaymentIntent(
  db: D1Database,
  intentId: string,
  failureCode: string,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE payment_intents
    SET status = 'failed', failure_code = ?, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'submitted')
  `).bind(failureCode, now, intentId).run()
  return (result.meta.changes ?? 0) === 1
}
