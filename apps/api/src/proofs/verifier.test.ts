import { KeyPair } from '@nimiq/core'
import {
  createProofEnvelope,
  hashCanonicalPayload,
  proofSigningMessage,
  type JsonValue,
  type ProofEnvelope,
} from '@nimtrace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { nimiqSignedMessageDigest } from '../auth/message'
import { verifySignedProof } from './verifier'

const now = new Date('2026-09-14T12:02:00.000Z')
const payload: JsonValue = {
  amountLuna: 125000,
  recipient: 'NQ00 MERCHANT',
  title: 'Café ☕ — 東京',
}

describe('signed lifecycle proof verification', () => {
  const keyPairs: KeyPair[] = []

  afterEach(() => {
    for (const keyPair of keyPairs.splice(0)) keyPair.free()
  })

  function createKeyPair() {
    const keyPair = KeyPair.generate()
    keyPairs.push(keyPair)
    return keyPair
  }

  function identity(keyPair: KeyPair) {
    const address = keyPair.toAddress()
    try {
      return {
        address: address.toUserFriendlyAddress(),
        publicKey: keyPair.publicKey.toHex(),
      }
    } finally {
      address.free()
    }
  }

  async function envelope(previousEventHash: string | null = 'a'.repeat(64)) {
    return createProofEnvelope({
      action: 'OFFER_TRANSFER',
      expiresAt: '2026-09-14T12:05:00.000Z',
      issuedAt: '2026-09-14T12:00:00.000Z',
      network: 'main-albatross',
      nonce: 'single-use-nonce-123456',
      payloadHash: await hashCanonicalPayload(payload),
      previousEventHash,
      summary: 'Offer “Café ☕ — 東京” to NQ00 MERCHANT for 0.00125 NIM.',
    })
  }

  async function sign(keyPair: KeyPair, proofEnvelope: ProofEnvelope) {
    const signature = keyPair.sign(await nimiqSignedMessageDigest(proofSigningMessage(proofEnvelope)))
    try {
      return signature.toHex()
    } finally {
      signature.free()
    }
  }

  async function validProof() {
    const keyPair = createKeyPair()
    const signer = identity(keyPair)
    const proofEnvelope = await envelope()
    return {
      expected: {
        action: 'OFFER_TRANSFER' as const,
        network: 'main-albatross' as const,
        nonce: proofEnvelope.nonce,
        now,
        previousEventHash: proofEnvelope.previousEventHash,
        signerAddress: signer.address,
      },
      keyPair,
      proof: {
        envelope: proofEnvelope,
        payload,
        publicKey: signer.publicKey,
        signature: await sign(keyPair, proofEnvelope),
      },
    }
  }

  it('accepts reordered Unicode payload fields and derives the signer address', async () => {
    const vector = await validProof()
    vector.proof.payload = {
      title: 'Café ☕ — 東京',
      recipient: 'NQ00 MERCHANT',
      amountLuna: 125000,
    }

    await expect(verifySignedProof(vector.proof, vector.expected)).resolves.toMatchObject({
      ok: true,
      derivedAddress: vector.expected.signerAddress,
    })
  })

  it('rejects cross-network replay and expired envelopes', async () => {
    const vector = await validProof()
    await expect(verifySignedProof(vector.proof, {
      ...vector.expected,
      network: 'test-albatross',
    })).resolves.toEqual({ ok: false, code: 'network_mismatch' })

    await expect(verifySignedProof(vector.proof, {
      ...vector.expected,
      now: new Date('2026-09-14T12:06:00.000Z'),
    })).resolves.toEqual({ ok: false, code: 'expired' })
  })

  it('rejects payload tampering after the user signs', async () => {
    const vector = await validProof()
    vector.proof.payload = { ...payload, amountLuna: 125001 }

    await expect(verifySignedProof(vector.proof, vector.expected)).resolves.toEqual({
      ok: false,
      code: 'payload_hash_mismatch',
    })
  })

  it('binds the previous lifecycle event hash', async () => {
    const vector = await validProof()
    const differentHead = 'b'.repeat(64)

    await expect(verifySignedProof(vector.proof, {
      ...vector.expected,
      previousEventHash: differentHead,
    })).resolves.toEqual({ ok: false, code: 'previous_event_hash_mismatch' })

    await expect(verifySignedProof({
      ...vector.proof,
      envelope: { ...vector.proof.envelope, previousEventHash: differentHead },
    }, {
      ...vector.expected,
      previousEventHash: differentHead,
    })).resolves.toEqual({ ok: false, code: 'invalid_signature' })
  })

  it('rejects the wrong public key and derived signer address', async () => {
    const vector = await validProof()
    const other = createKeyPair()
    const otherIdentity = identity(other)

    await expect(verifySignedProof({
      ...vector.proof,
      publicKey: otherIdentity.publicKey,
    }, vector.expected)).resolves.toEqual({ ok: false, code: 'invalid_signature' })

    await expect(verifySignedProof(vector.proof, {
      ...vector.expected,
      signerAddress: otherIdentity.address,
    })).resolves.toEqual({ ok: false, code: 'signer_address_mismatch' })
  })
})
