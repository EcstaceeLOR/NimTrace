import { z } from 'zod'

export const ProductImageResponseSchema = z.object({
  bytes: z.number().int().nonnegative(),
  fallback: z.boolean(),
  height: z.number().int().positive(),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  imageKey: z.string().min(1).max(512),
  url: z.string().min(1).max(1000),
  width: z.number().int().positive(),
}).strict()

export type ProductImageResponse = z.infer<typeof ProductImageResponseSchema>
