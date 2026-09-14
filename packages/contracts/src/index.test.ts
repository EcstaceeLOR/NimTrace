import { describe, expect, it } from 'vitest'
import {
  HealthResponseSchema,
  ProductPassportStatusSchema,
  WalletChallengeResponseSchema,
  WalletSessionRequestSchema,
} from './index'

describe('shared contracts', () => {
  it('accepts known passport lifecycle states', () => {
    expect(ProductPassportStatusSchema.parse('owned')).toBe('owned')
  })

  it('rejects malformed health timestamps', () => {
    expect(() => HealthResponseSchema.parse({
      status: 'ok',
      service: 'nimtrace-api',
      version: '0.1.0',
      environment: 'test',
      timestamp: 'today',
    })).toThrow()
  })

  it('validates the wallet authentication boundary', () => {
    expect(WalletChallengeResponseSchema.parse({
      challengeId: 'challenge-id-with-enough-entropy',
      walletAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
      network: 'main-albatross',
      issuedAt: '2026-09-14T12:00:00.000Z',
      expiresAt: '2026-09-14T12:05:00.000Z',
      message: 'NimTrace wallet sign-in\n\nAuthorize this wallet to access NimTrace. '.repeat(2),
    }).network).toBe('main-albatross')

    expect(() => WalletSessionRequestSchema.parse({
      challengeId: 'challenge-id-with-enough-entropy',
      walletAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
      network: 'wrong-network',
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
    })).toThrow()
  })
})
