import {
  PaymentVerificationResponseSchema,
  type NimiqNetwork,
  type PaymentVerificationReason,
  type PaymentVerificationResponse,
} from '@nimtrace/contracts'
import type { StoredPaymentIntent } from './repository'
import type { NimiqRpcClient, NimiqRpcTransaction } from './rpc'

// Sixty confirmations conservatively carries every micro-block transaction past
// the next macro block, where Albatross finalizes the preceding batch.
export const FINALITY_CONFIRMATIONS = 60
export const INCLUSION_GRACE_MS = 2 * 60 * 1000
const EARLY_BLOCK_CLOCK_TOLERANCE_MS = 30 * 1000

type VerificationResult = PaymentVerificationResponse & {
  chainTimestamp?: string
}

function response(
  intent: StoredPaymentIntent,
  checkedAt: string,
  state: PaymentVerificationResponse['state'],
  reason: PaymentVerificationReason,
  chain: { blockHeight?: number; confirmations?: number } = {},
): VerificationResult {
  return PaymentVerificationResponseSchema.parse({
    blockHeight: chain.blockHeight ?? intent.confirmedBlockHeight,
    checkedAt,
    confirmations: chain.confirmations ?? null,
    finalityConfirmations: FINALITY_CONFIRMATIONS,
    id: intent.intent.id,
    reason,
    state,
    transactionHash: intent.transactionHash,
  })
}

function field(transaction: NimiqRpcTransaction, ...names: string[]) {
  for (const name of names) {
    if (name in transaction) return transaction[name]
  }
  return undefined
}

function integerField(transaction: NimiqRpcTransaction, ...names: string[]) {
  const value = field(transaction, ...names)
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function stringField(transaction: NimiqRpcTransaction, ...names: string[]) {
  const value = field(transaction, ...names)
  return typeof value === 'string' ? value : undefined
}

function normalizeAddress(address: string) {
  return address.replace(/\s+/g, '').toUpperCase()
}

function transactionNetwork(transaction: NimiqRpcTransaction): NimiqNetwork | 'other' | undefined {
  const networkId = field(transaction, 'networkId', 'network_id')
  if (networkId === 24) return 'main-albatross'
  if (networkId === 5) return 'test-albatross'
  if (networkId !== undefined) return 'other'

  const network = stringField(transaction, 'network')?.replace(/[-_\s]/g, '').toLowerCase()
  if (network === 'mainalbatross') return 'main-albatross'
  if (network === 'testalbatross') return 'test-albatross'
  if (network !== undefined) return 'other'
  return undefined
}

function rawTransactionData(transaction: NimiqRpcTransaction) {
  const direct = stringField(transaction, 'recipientData', 'recipient_data')
  if (direct !== undefined) return direct
  const data = field(transaction, 'data')
  if (typeof data === 'string') return data
  if (typeof data === 'object' && data !== null && 'raw' in data) {
    return typeof data.raw === 'string' ? data.raw : undefined
  }
  return undefined
}

function decodeHexUtf8(hexValue: string) {
  const hex = hexValue.startsWith('0x') ? hexValue.slice(2) : hexValue
  if (hex.length % 2 !== 0 || !/^[a-f0-9]*$/i.test(hex)) return undefined
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function transactionDataResult(transaction: NimiqRpcTransaction, expected: string) {
  const raw = rawTransactionData(transaction)
  if (raw === undefined) return 'unavailable' as const
  const decoded = decodeHexUtf8(raw)
  if (decoded === undefined) return 'unavailable' as const
  return decoded === expected ? 'matches' as const : 'mismatch' as const
}

function collectRelationshipAddresses(transaction: NimiqRpcTransaction) {
  const addresses: string[] = []
  const related = field(transaction, 'relatedAddresses', 'related_addresses')
  if (Array.isArray(related)) {
    addresses.push(...related.filter((value): value is string => typeof value === 'string'))
  }

  // Newer typed clients expose decoded HTLC proof participants. These are used
  // only when present; the verifier never assumes the contract payout sender is
  // the authenticated wallet.
  const proof = field(transaction, 'proof')
  if (typeof proof === 'object' && proof !== null) {
    const proofFields = proof as Record<string, unknown>
    for (const name of ['signer', 'creator']) {
      const candidate = proofFields[name]
      if (typeof candidate === 'string') addresses.push(candidate)
    }
  }
  return addresses
}

export function buyerRelationshipResult(transaction: NimiqRpcTransaction, buyerAddress: string) {
  const addresses = collectRelationshipAddresses(transaction)
  if (addresses.length === 0) return 'unavailable' as const
  const buyer = normalizeAddress(buyerAddress)
  return addresses.some((address) => normalizeAddress(address) === buyer) ? 'matches' as const : 'mismatch' as const
}

function transactionTimestamp(transaction: NimiqRpcTransaction) {
  const value = integerField(transaction, 'timestamp')
  if (value === undefined) return undefined
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function executionState(transaction: NimiqRpcTransaction) {
  const executionResult = field(transaction, 'executionResult', 'execution_result')
  const state = stringField(transaction, 'state')?.toLowerCase()
  if (executionResult === false || state === 'invalidated' || state === 'expired') return 'failed' as const
  if (state === 'new' || state === 'pending') return 'pending' as const
  if (executionResult === true || state === 'included' || state === 'confirmed') return 'executed' as const
  return 'unknown' as const
}

export async function verifyStoredPaymentIntent(
  intent: StoredPaymentIntent,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  now = new Date(),
): Promise<VerificationResult> {
  const checkedAt = now.toISOString()
  if (intent.intent.status === 'confirmed') {
    return response(intent, checkedAt, 'verified', 'verified_final')
  }
  if (intent.intent.status === 'failed'
    || intent.intent.status === 'expired'
    || intent.intent.status === 'cancelled') {
    return response(intent, checkedAt, 'rejected', 'intent_inactive')
  }
  if (!intent.transactionHash) {
    return response(intent, checkedAt, 'pending', 'transaction_not_submitted')
  }

  const lookup = await rpc.getTransaction(intent.transactionHash)
  if (lookup.status === 'not_found') {
    return response(intent, checkedAt, 'pending', 'transaction_not_found')
  }
  if (lookup.status === 'unavailable') {
    return response(intent, checkedAt, 'inconclusive', 'provider_unavailable')
  }
  if (lookup.status === 'invalid') {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid')
  }

  const transaction = lookup.transaction
  const blockHeight = integerField(transaction, 'blockNumber', 'blockHeight', 'block_number')
  const confirmations = integerField(transaction, 'confirmations')
  const chain = { blockHeight, confirmations }
  const hash = stringField(transaction, 'hash', 'transactionHash', 'transaction_hash')
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  }
  if (hash.toLowerCase() !== intent.transactionHash.toLowerCase()) {
    return response(intent, checkedAt, 'rejected', 'transaction_hash_mismatch', chain)
  }
  const network = transactionNetwork(transaction)
  if (!network) return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  if (network !== intent.intent.network) {
    return response(intent, checkedAt, 'rejected', 'network_mismatch', chain)
  }

  const execution = executionState(transaction)
  if (execution === 'failed') return response(intent, checkedAt, 'rejected', 'execution_failed', chain)
  if (execution === 'unknown') return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)

  const recipient = stringField(transaction, 'to', 'recipient')
  if (!recipient) return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  if (normalizeAddress(recipient) !== normalizeAddress(intent.intent.sellerAddress)) {
    return response(intent, checkedAt, 'rejected', 'recipient_mismatch', chain)
  }
  const value = integerField(transaction, 'value')
  if (value === undefined) return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  if (value !== intent.intent.amountLuna) {
    return response(intent, checkedAt, 'rejected', 'amount_mismatch', chain)
  }
  const data = transactionDataResult(transaction, intent.intent.transactionData)
  if (data === 'unavailable') {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  }
  if (data === 'mismatch') {
    return response(intent, checkedAt, 'rejected', 'transaction_data_mismatch', chain)
  }

  const relationship = buyerRelationshipResult(transaction, intent.intent.buyerAddress)
  if (relationship === 'unavailable') {
    return response(intent, checkedAt, 'inconclusive', 'buyer_relationship_unavailable', chain)
  }
  if (relationship === 'mismatch') {
    return response(intent, checkedAt, 'rejected', 'buyer_unrelated', chain)
  }

  if (execution === 'pending') {
    return response(intent, checkedAt, 'pending', 'awaiting_inclusion', chain)
  }
  if (blockHeight === undefined) {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  }
  const timestamp = transactionTimestamp(transaction)
  if (timestamp === undefined) {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  }
  const earliest = Date.parse(intent.intent.createdAt) - EARLY_BLOCK_CLOCK_TOLERANCE_MS
  const latest = Date.parse(intent.intent.expiresAt) + INCLUSION_GRACE_MS
  if (timestamp < earliest || timestamp > latest) {
    return response(intent, checkedAt, 'rejected', 'transaction_time_invalid', chain)
  }
  if (confirmations === undefined) {
    return response(intent, checkedAt, 'inconclusive', 'provider_response_invalid', chain)
  }
  if (confirmations < FINALITY_CONFIRMATIONS) {
    return response(intent, checkedAt, 'pending', 'awaiting_finality', chain)
  }

  return {
    ...response(intent, checkedAt, 'verified', 'verified_final', chain),
    chainTimestamp: new Date(timestamp).toISOString(),
  }
}
