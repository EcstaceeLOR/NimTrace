import { z } from 'zod'
import { PublicProductResponseSchema } from './products'

export const PublicProductListResponseSchema = z.object({
  items: z.array(PublicProductResponseSchema),
}).strict()

export type PublicProductListResponse = z.infer<typeof PublicProductListResponseSchema>
