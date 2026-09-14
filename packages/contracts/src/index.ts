import { z } from 'zod'

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('nimtrace-api'),
  version: z.string().min(1),
  environment: z.string().min(1),
  timestamp: z.iso.datetime(),
})

export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const ProductPassportStatusSchema = z.enum([
  'draft',
  'available',
  'payment_pending',
  'owned',
  'transfer_pending',
  'retired',
])

export type ProductPassportStatus = z.infer<typeof ProductPassportStatusSchema>

export interface WalletIdentity {
  address: string
  label?: string
}
