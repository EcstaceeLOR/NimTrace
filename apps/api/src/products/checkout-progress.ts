import {
  PublicCheckoutProgressResponseSchema,
  type NimiqNetwork,
  type PaymentIntentStatus,
  type PublicCheckoutProgressResponse,
} from '@nimtrace/contracts'
import type { NimiqRpcClient } from '../payments/rpc'
import type { StoredPaymentIntent } from '../payments/repository'
import { INCLUSION_GRACE_MS, verifyStoredPaymentIntent } from '../payments/verification'

interface ActiveCheckoutRow {
  amount_luna: number
  buyer_address: string
  confirmed_at: string | null
  confirmed_block_height: number | null
  created_at: string
  expires_at: string
  failure_code: string | null
  id: string
  network: NimiqNetwork
  product_id: string
  product_version: number
  seller_address: string
  status: PaymentIntentStatus
  transaction_data: string
  transaction_hash: string | null
}

export async function getPublicCheckoutProgress(
  db: D1Database,
  productId: string,
  network: NimiqNetwork,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  now = new Date(),
): Promise<PublicCheckoutProgressResponse | null> {
  const cutoff = new Date(now.getTime() - INCLUSION_GRACE_MS).toISOString()
  const row = await db.prepare(`
    SELECT
      id, product_id, product_version, seller_address, buyer_address,
      amount_luna, network, transaction_data, expires_at, status,
      transaction_hash, confirmed_block_height, confirmed_at, failure_code,
      created_at
    FROM payment_intents
    WHERE product_id = ?
      AND purpose = 'initial_purchase'
      AND network = ?
      AND (
        status IN ('submitted', 'confirmed')
        OR (status = 'pending' AND expires_at > ?)
      )
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(productId, network, cutoff).first<ActiveCheckoutRow>()

  if (!row) return null

  const stored: StoredPaymentIntent = {
    confirmedAt: row.confirmed_at,
    confirmedBlockHeight: row.confirmed_block_height,
    failureCode: row.failure_code,
    intent: {
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
    },
    transactionHash: row.transaction_hash,
  }
  const verification = await verifyStoredPaymentIntent(stored, rpc, now)
  const transactionDetected = Boolean(row.transaction_hash)
  const included = row.status === 'confirmed'
    || verification.state === 'verified'
    || verification.blockHeight !== null
    || verification.confirmations !== null
  const finalityReached = row.status === 'confirmed' || verification.state === 'verified'

  return PublicCheckoutProgressResponseSchema.parse({
    blockHeight: verification.blockHeight,
    checkedAt: verification.checkedAt,
    confirmations: verification.confirmations,
    finalityConfirmations: verification.finalityConfirmations,
    finalityReached,
    included,
    transactionDetected,
  })
}
