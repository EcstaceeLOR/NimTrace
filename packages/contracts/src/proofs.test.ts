import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  canonicalPayload,
  createProofEnvelope,
  hashCanonicalPayload,
  proofSigningMessage,
} from './proofs'

describe('canonical NimTrace proofs', () => {
  it('produces identical canonical JSON and hashes regardless of field order', async () => {
    const first = { title: 'Genesis', details: { warrantyDays: 365, active: true }, tags: ['a', 'b'] }
    const reordered = { tags: ['a', 'b'], details: { active: true, warrantyDays: 365 }, title: 'Genesis' }

    expect(canonicalJson(first)).toBe(canonicalJson(reordered))
    expect(canonicalPayload(first)).toBe(canonicalPayload(reordered))
    await expect(hashCanonicalPayload(first)).resolves.toBe(await hashCanonicalPayload(reordered))
  })

  it('preserves Unicode data deterministically in a versioned payload', async () => {
    const payload = { description: 'Café ☕ — 東京', serial: 'É-001' }

    expect(canonicalPayload(payload)).toBe(
      '{"data":{"description":"Café ☕ — 東京","serial":"É-001"},"version":1}',
    )
    await expect(hashCanonicalPayload(payload)).resolves.toBe(
      '471ef86b72ab7067f795dcd00b7acb0f120062abacfe004d8b26239839285210',
    )
  })

  it('rejects values that JSON cannot represent without information loss', () => {
    expect(() => canonicalJson({ omitted: undefined })).toThrow(/does not support undefined/)
    expect(() => canonicalJson(Array(1))).toThrow(/does not support undefined/)
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow(/non-finite/)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/)
  })

  it('builds a strict envelope and prepends its readable action summary', () => {
    const envelope = createProofEnvelope({
      action: 'ISSUE_PRODUCT',
      expiresAt: '2026-09-14T12:05:00.000Z',
      issuedAt: '2026-09-14T12:00:00.000Z',
      network: 'main-albatross',
      nonce: 'single-use-nonce-123456',
      payloadHash: 'a'.repeat(64),
      previousEventHash: null,
      summary: 'Issue “Genesis Edition” with a 365-day warranty.',
    })
    const message = proofSigningMessage(envelope)

    expect(message).toContain('Issue “Genesis Edition” with a 365-day warranty.')
    expect(message).toContain('This signature does not send NIM.')
    expect(message).toContain('"app":"nimtrace"')
    expect(message).toContain('"previousEventHash":null')
  })
})
