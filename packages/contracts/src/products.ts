import { z } from 'zod'
import { PublicCheckoutProgressResponseSchema } from './payments'
import { ProofEnvelopeSchema } from './proofs'

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const ProductDraftSchema = z.object({
  description: z.string().trim().max(4000).default(''),
  imageHash: hashSchema,
  imageKey: z.string().trim().min(1).max(512),
  priceLuna: z.number().int().positive().safe(),
  serialReference: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  warrantyDurationDays: z.number().int().min(0).max(36500),
  warrantySummary: z.string().trim().min(1).max(1000),
}).strict()

export const ProductPayloadSchema = z.object({
  description: z.string().max(4000),
  imageHash: hashSchema,
  imageKey: z.string().min(1).max(512),
  issuerAddress: z.string().min(8).max(64),
  priceLuna: z.number().int().positive().safe(),
  productId: z.string().min(24).max(128),
  serialNumberHash: hashSchema,
  title: z.string().min(1).max(120),
  version: z.literal(1),
  warrantyDurationDays: z.number().int().min(0).max(36500),
  warrantySummary: z.string().min(1).max(1000),
}).strict()

export const ProductIssuanceChallengeResponseSchema = z.object({
  envelope: ProofEnvelopeSchema,
  message: z.string().min(80).max(4000),
  payload: ProductPayloadSchema,
}).strict()

export const PublishProductRequestSchema = z.object({
  proof: z.object({
    envelope: ProofEnvelopeSchema,
    payload: ProductPayloadSchema,
    publicKey: z.string().regex(/^[a-f0-9]{64}$/i),
    signature: z.string().regex(/^[a-f0-9]{128}$/i),
  }).strict(),
}).strict()

export const PublishedProductResponseSchema = z.object({
  id: z.string().min(24).max(128),
  status: z.literal('published'),
  version: z.number().int().positive(),
}).strict()

export const PublicProductStateSchema = z.enum([
  'available',
  'checked_out',
  'owned',
  'replaced',
  'suspended',
  'invalid',
])

export const PublicProductResponseSchema = z.object({
  checkoutProgress: PublicCheckoutProgressResponseSchema.nullable(),
  currentVersion: z.number().int().positive(),
  description: z.string().max(4000),
  id: z.string().min(1).max(128),
  imageUrl: z.string().min(1).max(1000),
  issuedAt: z.iso.datetime(),
  issuerAddress: z.string().min(8).max(64),
  priceLuna: z.number().int().positive().safe(),
  proofHash: hashSchema,
  serialFingerprint: z.string().regex(/^[a-f0-9]{12}$/),
  signatureState: z.enum(['verified', 'invalid']),
  state: PublicProductStateSchema,
  title: z.string().min(1).max(120),
  version: z.number().int().positive(),
  warrantyDurationDays: z.number().int().min(0).max(36500),
  warrantySummary: z.string().min(1).max(1000),
}).strict()

export type ProductDraft = z.infer<typeof ProductDraftSchema>
export type ProductPayload = z.infer<typeof ProductPayloadSchema>
export type ProductIssuanceChallengeResponse = z.infer<typeof ProductIssuanceChallengeResponseSchema>
export type PublishProductRequest = z.infer<typeof PublishProductRequestSchema>
export type PublishedProductResponse = z.infer<typeof PublishedProductResponseSchema>
export type PublicProductResponse = z.infer<typeof PublicProductResponseSchema>
export type PublicProductState = z.infer<typeof PublicProductStateSchema>
