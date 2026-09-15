import { z } from 'zod'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const idSchema = z.string().length(24).regex(/^[A-Za-z0-9_-]+$/)

export const IssuedPassportEventPayloadSchema = z.object({
  eventType: z.literal('issued'),
  ownerAddress: z.string().min(8).max(64),
  passportId: idSchema,
  payment: z.object({
    blockHeight: z.number().int().nonnegative().safe(),
    confirmedAt: z.iso.datetime(),
    intentId: idSchema,
    transactionHash: hashSchema,
  }).strict(),
  product: z.object({
    id: z.string().min(8).max(128),
    payloadHash: hashSchema,
    version: z.number().int().positive(),
  }).strict(),
  warranty: z.object({
    expiresAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
  }).strict(),
}).strict()

export const IssuedPassportResponseSchema = z.object({
  auditState: z.literal('verified'),
  currentOwnerAddress: z.string().min(8).max(64),
  firstEventHash: hashSchema,
  headEventHash: hashSchema,
  id: idSchema,
  issuedAt: z.iso.datetime(),
  productId: z.string().min(8).max(128),
  productVersion: z.number().int().positive(),
  purchaseBlockHeight: z.number().int().nonnegative().safe(),
  purchaseIntentId: idSchema,
  purchaseTransactionHash: hashSchema,
  status: z.enum(['active', 'transfer_pending', 'suspended', 'retired']),
  version: z.number().int().positive(),
  warrantyExpiresAt: z.iso.datetime(),
  warrantyStartedAt: z.iso.datetime(),
}).strict()

export type IssuedPassportResponse = z.infer<typeof IssuedPassportResponseSchema>
export type IssuedPassportEventPayload = z.infer<typeof IssuedPassportEventPayloadSchema>
