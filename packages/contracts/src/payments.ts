import { z } from 'zod'

const paymentNetworkSchema = z.enum(['main-albatross', 'test-albatross'])

export const IdempotencyKeySchema = z.string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/)

export const PaymentIntentStatusSchema = z.enum([
  'pending',
  'submitted',
  'confirmed',
  'expired',
  'failed',
  'cancelled',
])

export const PurchaseIntentRequestSchema = z.object({}).strict()

export const PurchaseIntentResponseSchema = z.object({
  amountLuna: z.number().int().positive().safe(),
  buyerAddress: z.string().min(8).max(64),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  id: z.string().length(24).regex(/^[A-Za-z0-9_-]+$/),
  network: paymentNetworkSchema,
  productId: z.string().min(24).max(128),
  productVersion: z.number().int().positive(),
  sellerAddress: z.string().min(8).max(64),
  status: PaymentIntentStatusSchema,
  transactionData: z.string().min(8).max(64),
}).strict()

export const PaymentSubmissionRequestSchema = z.object({
  transactionHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict()

export const PaymentSubmissionResponseSchema = z.object({
  id: z.string().length(24).regex(/^[A-Za-z0-9_-]+$/),
  status: z.enum(['submitted', 'confirmed']),
  transactionHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict()

export const PaymentVerificationStateSchema = z.enum([
  'verified',
  'pending',
  'rejected',
  'inconclusive',
])

export const PaymentVerificationReasonSchema = z.enum([
  'verified_final',
  'transaction_not_submitted',
  'transaction_not_found',
  'awaiting_inclusion',
  'awaiting_finality',
  'provider_unavailable',
  'provider_response_invalid',
  'transaction_hash_mismatch',
  'network_mismatch',
  'execution_failed',
  'recipient_mismatch',
  'amount_mismatch',
  'transaction_data_mismatch',
  'buyer_relationship_unavailable',
  'buyer_unrelated',
  'transaction_time_invalid',
  'intent_inactive',
])

export const PaymentVerificationResponseSchema = z.object({
  blockHeight: z.number().int().nonnegative().safe().nullable(),
  checkedAt: z.iso.datetime(),
  confirmations: z.number().int().nonnegative().safe().nullable(),
  finalityConfirmations: z.number().int().positive().safe(),
  id: z.string().length(24).regex(/^[A-Za-z0-9_-]+$/),
  reason: PaymentVerificationReasonSchema,
  state: PaymentVerificationStateSchema,
  transactionHash: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
}).strict()

export const PublicCheckoutProgressResponseSchema = z.object({
  blockHeight: z.number().int().nonnegative().safe().nullable(),
  checkedAt: z.iso.datetime(),
  confirmations: z.number().int().nonnegative().safe().nullable(),
  finalityConfirmations: z.number().int().positive().safe(),
  finalityReached: z.boolean(),
  included: z.boolean(),
  transactionDetected: z.boolean(),
}).strict()

export type PaymentIntentStatus = z.infer<typeof PaymentIntentStatusSchema>
export type PurchaseIntentResponse = z.infer<typeof PurchaseIntentResponseSchema>
export type PaymentSubmissionResponse = z.infer<typeof PaymentSubmissionResponseSchema>
export type PaymentVerificationState = z.infer<typeof PaymentVerificationStateSchema>
export type PaymentVerificationReason = z.infer<typeof PaymentVerificationReasonSchema>
export type PaymentVerificationResponse = z.infer<typeof PaymentVerificationResponseSchema>
export type PublicCheckoutProgressResponse = z.infer<typeof PublicCheckoutProgressResponseSchema>
