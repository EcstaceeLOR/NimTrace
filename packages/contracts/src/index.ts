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

export const NimiqNetworkSchema = z.enum(['main-albatross', 'test-albatross'])
export type NimiqNetwork = z.infer<typeof NimiqNetworkSchema>

export const WalletChallengeRequestSchema = z.object({
  walletAddress: z.string().trim().min(8).max(64),
})

export const WalletChallengeResponseSchema = z.object({
  challengeId: z.string().min(24).max(128),
  walletAddress: z.string().min(8).max(64),
  network: NimiqNetworkSchema,
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  message: z.string().min(80).max(2000),
})

export const WalletSessionRequestSchema = z.object({
  challengeId: z.string().min(24).max(128),
  walletAddress: z.string().trim().min(8).max(64),
  network: NimiqNetworkSchema,
  publicKey: z.string().regex(/^[a-f0-9]{64}$/i),
  signature: z.string().regex(/^[a-f0-9]{128}$/i),
})

export const WalletSessionResponseSchema = z.object({
  sessionToken: z.string().min(40).max(128),
  walletAddress: z.string().min(8).max(64),
  expiresAt: z.iso.datetime(),
})

export const AuthErrorResponseSchema = z.object({
  error: z.enum([
    'invalid_request',
    'invalid_address',
    'invalid_challenge',
    'challenge_expired',
    'challenge_consumed',
    'network_mismatch',
    'wallet_address_mismatch',
    'invalid_signature',
    'internal_error',
  ]),
  message: z.string().min(1),
  recoverable: z.boolean(),
})

export type WalletChallengeRequest = z.infer<typeof WalletChallengeRequestSchema>
export type WalletChallengeResponse = z.infer<typeof WalletChallengeResponseSchema>
export type WalletSessionRequest = z.infer<typeof WalletSessionRequestSchema>
export type WalletSessionResponse = z.infer<typeof WalletSessionResponseSchema>
export type AuthErrorResponse = z.infer<typeof AuthErrorResponseSchema>

export * from './proofs'
export * from './products'
