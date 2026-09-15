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

export const PassportSummarySchema = z.object({
  auditState: z.enum(['verified', 'invalid', 'degraded']),
  currentOwnerAddress: z.string().min(8).max(64),
  id: idSchema,
  imageUrl: z.string().min(1).max(2048),
  issuerAddress: z.string().min(8).max(64),
  issuedAt: z.iso.datetime(),
  ownership: z.enum(['current', 'former']),
  productId: z.string().min(8).max(128),
  productTitle: z.string().min(1).max(120),
  productVersion: z.number().int().positive(),
  recentlyIssued: z.boolean(),
  status: z.enum(['active', 'transfer_pending', 'suspended', 'retired']),
  warrantyDaysRemaining: z.number().int().nonnegative().safe(),
  warrantyExpiresAt: z.iso.datetime(),
  warrantyState: z.enum(['active', 'expired', 'none']),
}).strict()

export const PassportEventSummarySchema = z.object({
  actorAddress: z.string().min(8).max(64),
  createdAt: z.iso.datetime(),
  eventHash: hashSchema,
  previousEventHash: hashSchema.nullable(),
  sequence: z.number().int().positive(),
  type: z.enum(['issued', 'transferred', 'repaired', 'warranty_claimed', 'corrected', 'retired']),
}).strict()

export const PassportDetailSchema = PassportSummarySchema.extend({
  description: z.string().max(4000),
  events: z.array(PassportEventSummarySchema).min(1),
  headEventHash: hashSchema,
  ownerActions: z.array(z.enum(['transfer', 'present_warranty'])),
  productProofHash: hashSchema,
  publicUrl: z.string().url(),
  purchaseBlockHeight: z.number().int().nonnegative().safe(),
  purchaseConfirmedAt: z.iso.datetime(),
  purchaseIntentId: idSchema,
  purchaseTransactionHash: hashSchema,
  warrantyStartedAt: z.iso.datetime(),
  warrantySummary: z.string().min(1).max(1000),
}).strict()

export const PassportCollectionResponseSchema = z.object({
  items: z.array(PassportSummarySchema),
}).strict()

export type PassportSummary = z.infer<typeof PassportSummarySchema>
export type PassportDetail = z.infer<typeof PassportDetailSchema>
export type PassportCollectionResponse = z.infer<typeof PassportCollectionResponseSchema>

export const PublicPassportOverallStateSchema = z.enum([
  'verified',
  'partially_verified',
  'unverified',
  'merchant_claim',
])

const PublicEvidenceStateSchema = z.enum(['verified', 'partial', 'unverified', 'claim'])

export const PublicPassportEventSchema = PassportEventSummarySchema.omit({ actorAddress: true }).extend({
  maskedActor: z.string().min(8).max(32),
}).strict()

export const PublicPassportVerificationSchema = z.object({
  checkedAt: z.iso.datetime(),
  eventChain: z.object({
    eventCount: z.number().int().positive().safe(),
    events: z.array(PublicPassportEventSchema).min(1),
    headEventHash: hashSchema,
    state: PublicEvidenceStateSchema,
  }).strict(),
  id: idSchema,
  merchantClaims: z.object({
    description: z.string().max(4000),
    warrantySummary: z.string().min(1).max(1000),
  }).strict(),
  overallState: PublicPassportOverallStateSchema,
  ownership: z.object({
    maskedCurrentOwner: z.string().min(8).max(32),
    state: PublicEvidenceStateSchema,
  }).strict(),
  product: z.object({
    imageUrl: z.string().min(1).max(2048),
    issuerAddress: z.string().min(8).max(64),
    payloadHash: hashSchema,
    state: PublicEvidenceStateSchema,
    title: z.string().min(1).max(120),
    version: z.number().int().positive(),
  }).strict(),
  publicUrl: z.string().url(),
  purchase: z.object({
    blockHeight: z.number().int().nonnegative().safe(),
    confirmedAt: z.iso.datetime(),
    reason: z.string().min(1).max(80),
    state: PublicEvidenceStateSchema,
    transactionHash: hashSchema,
  }).strict(),
  status: z.enum(['active', 'transfer_pending', 'suspended', 'retired']),
  warranty: z.object({
    daysRemaining: z.number().int().nonnegative().safe(),
    expiresAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    state: z.enum(['active', 'expired', 'none']),
  }).strict(),
}).strict()

export type PublicPassportVerification = z.infer<typeof PublicPassportVerificationSchema>

export const WarrantyPresentationResponseSchema = z.object({
  expiresAt: z.iso.datetime(),
  passportId: idSchema,
  url: z.string().url(),
}).strict()

export const MerchantWarrantyPresentationSchema = z.object({
  expiresAt: z.iso.datetime(),
  passport: PublicPassportVerificationSchema,
  presentationType: z.literal('merchant_view'),
}).strict()

export type WarrantyPresentationResponse = z.infer<typeof WarrantyPresentationResponseSchema>
export type MerchantWarrantyPresentation = z.infer<typeof MerchantWarrantyPresentationSchema>
