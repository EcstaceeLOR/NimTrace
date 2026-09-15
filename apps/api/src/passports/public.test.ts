import { canonicalJson, sha256Hex } from '@nimtrace/contracts'
import { describe, expect, it } from 'vitest'
import type { PassportAuditEventRecord } from './repository'
import { validatePassportEventChain } from './public'
import { computePassportEventHash } from './service'

async function issuedEvent(): Promise<PassportAuditEventRecord> {
  const canonicalPayload = canonicalJson({
    eventType: 'issued',
    ownerAddress: 'NQ34 BUYER 0000 0000 0000 0000 0000 0000 0000',
    passportId: 'passport-id-with-entropy',
  })
  const payloadHash = await sha256Hex(canonicalPayload)
  const eventHash = await computePassportEventHash(
    'passport-id-with-entropy', payloadHash, null, 1, 'issued',
  )
  return {
    actorAddress: 'NQ12 SELLER 0000 0000 0000 0000 0000 0000 0000',
    canonicalPayload,
    createdAt: '2026-09-15T10:00:00.000Z',
    eventHash,
    payloadHash,
    previousEventHash: null,
    sequence: 1,
    type: 'issued',
  }
}

describe('public passport event-chain verification', () => {
  it('accepts a canonical linked chain and rejects tampered event fixtures', async () => {
    const event = await issuedEvent()
    expect(await validatePassportEventChain('passport-id-with-entropy', event.eventHash, [event])).toBe(true)
    expect(await validatePassportEventChain('passport-id-with-entropy', event.eventHash, [{
      ...event,
      canonicalPayload: event.canonicalPayload.replace('issued', 'retired'),
    }])).toBe(false)
    expect(await validatePassportEventChain('passport-id-with-entropy', '0'.repeat(64), [event])).toBe(false)
  })
})
