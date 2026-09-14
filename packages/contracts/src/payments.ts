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

export type PaymentIntentStatus = z.infer<typeof PaymentIntentStatusSchema>
export type PurchaseIntentResponse = z.infer<typeof PurchaseIntentResponseSchema>
