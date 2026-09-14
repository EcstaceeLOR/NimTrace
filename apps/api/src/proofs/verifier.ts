import {
  SignedProofSchema,
  canonicalPayload,
  hashCanonicalPayload,
  proofSigningMessage,
  type NimiqNetwork,
  type ProofAction,
  type SignedProof,
} from '@nimtrace/contracts'
import { normalizeNimiqAddress, verifyWalletSignature } from '../auth/crypto'

export type ProofVerificationErrorCode =
  | 'invalid_envelope'
  | 'network_mismatch'
  | 'action_mismatch'
  | 'nonce_mismatch'
  | 'previous_event_hash_mismatch'
  | 'not_yet_valid'
  | 'expired'
  | 'payload_hash_mismatch'
  | 'invalid_signature'
  | 'signer_address_mismatch'

export type ProofVerificationResult =
  | {
    ok: true
    canonicalPayload: string
    derivedAddress: string
    message: string
  }
  | { ok: false; code: ProofVerificationErrorCode }

interface ProofExpectations {
  action: ProofAction
  network: NimiqNetwork
  nonce: string
  previousEventHash: string | null
  signerAddress: string
  now?: Date
}

function mismatch(code: ProofVerificationErrorCode): ProofVerificationResult {
  return { ok: false, code }
}

export async function verifySignedProof(
  proof: SignedProof,
  expected: ProofExpectations,
): Promise<ProofVerificationResult> {
  const parsedProof = SignedProofSchema.safeParse(proof)
  if (!parsedProof.success) return mismatch('invalid_envelope')
  const envelope = parsedProof.data.envelope

  if (envelope.network !== expected.network) return mismatch('network_mismatch')
  if (envelope.action !== expected.action) return mismatch('action_mismatch')
  if (envelope.nonce !== expected.nonce) return mismatch('nonce_mismatch')
  if (envelope.previousEventHash !== expected.previousEventHash) {
    return mismatch('previous_event_hash_mismatch')
  }

  const now = (expected.now ?? new Date()).getTime()
  if (Date.parse(envelope.issuedAt) > now) return mismatch('not_yet_valid')
  if (Date.parse(envelope.expiresAt) <= now) return mismatch('expired')
  if (await hashCanonicalPayload(parsedProof.data.payload) !== envelope.payloadHash) {
    return mismatch('payload_hash_mismatch')
  }

  const message = proofSigningMessage(envelope)
  const verification = await verifyWalletSignature(
    message,
    parsedProof.data.publicKey,
    parsedProof.data.signature,
  )
  if (!verification?.valid) return mismatch('invalid_signature')

  let signerAddress: string
  try {
    signerAddress = normalizeNimiqAddress(expected.signerAddress)
  } catch {
    return mismatch('signer_address_mismatch')
  }
  if (verification.address !== signerAddress) return mismatch('signer_address_mismatch')

  return {
    ok: true,
    canonicalPayload: canonicalPayload(parsedProof.data.payload),
    derivedAddress: verification.address,
    message,
  }
}
