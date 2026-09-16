import { z } from 'zod'

export const MerchantProductStateSchema = z.enum(['available', 'owned', 'suspended', 'retired'])

export const MerchantProductSummarySchema = z.object({
  id: z.string().min(1).max(128),
  issuedAt: z.iso.datetime(),
  passportId: z.string().min(1).max(128).nullable(),
  passportStatus: z.enum(['active', 'transfer_pending', 'suspended', 'retired']).nullable(),
  priceLuna: z.number().int().positive().safe(),
  purchaserMasked: z.string().min(1).max(64).nullable(),
  state: MerchantProductStateSchema,
  title: z.string().min(1).max(120),
  warrantyDurationDays: z.number().int().min(0).max(36500),
  warrantySummary: z.string().min(1).max(1000),
}).strict()

export const MerchantProductListResponseSchema = z.object({
  items: z.array(MerchantProductSummarySchema),
}).strict()

export type MerchantProductSummary = z.infer<typeof MerchantProductSummarySchema>
export type MerchantProductListResponse = z.infer<typeof MerchantProductListResponseSchema>
