import {
  canonicalJson,
  canonicalPayload,
  createProofEnvelope,
  hashCanonicalPayload,
  proofSigningMessage,
  sha256Hex,
  type NimiqNetwork,
  type ProductDraft,
  type ProductIssuanceChallengeResponse,
  type PublishProductRequest,
  type PublishedProductResponse,
} from '@nimtrace/contracts'
import { randomToken } from '../auth/crypto'
import { verifySignedProof } from '../proofs/verifier'
import { findProofNonce, insertProofNonce, publishProduct } from './repository'

const PROOF_TTL_MS = 5 * 60 * 1000

export class ProductServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 409 | 410,
  ) {
    super(message)
  }
}

function fail(code: string, message: string, status: ProductServiceError['status']): never {
  throw new ProductServiceError(code, message, status)
}

export async function issueProductProof(
  db: D1Database,
  walletAddress: string,
  draft: ProductDraft,
  network: NimiqNetwork,
  now = new Date(),
): Promise<ProductIssuanceChallengeResponse> {
  const productId = randomToken(24)
  const nonce = randomToken(24)
  const issuedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + PROOF_TTL_MS).toISOString()
  const payload = {
    description: draft.description,
    imageHash: draft.imageHash,
    imageKey: draft.imageKey,
    issuerAddress: walletAddress,
    priceLuna: draft.priceLuna,
    productId,
    serialNumberHash: await sha256Hex(draft.serialReference.normalize('NFKC').toUpperCase()),
    title: draft.title,
    version: 1 as const,
    warrantyDurationDays: draft.warrantyDurationDays,
    warrantySummary: draft.warrantySummary,
  }
  const payloadHash = await hashCanonicalPayload(payload)
  const envelope = createProofEnvelope({
    action: 'ISSUE_PRODUCT',
    expiresAt,
    issuedAt,
    network,
    nonce,
    payloadHash,
    previousEventHash: null,
    summary: `Issue “${payload.title}” for ${payload.priceLuna} Luna with a ${payload.warrantyDurationDays}-day warranty.`,
  })

  await insertProofNonce(db, {
    action: envelope.action,
    consumed_at: null,
    expires_at: expiresAt,
    id: nonce,
    payload_hash: payloadHash,
    resource_id: productId,
    wallet_address: walletAddress,
  }, issuedAt)

  return { envelope, message: proofSigningMessage(envelope), payload }
}

export async function createPublishedProduct(
  db: D1Database,
  walletAddress: string,
  request: PublishProductRequest,
  network: NimiqNetwork,
  now = new Date(),
): Promise<PublishedProductResponse> {
  const { proof } = request
  const nonce = await findProofNonce(db, proof.envelope.nonce)
  if (!nonce || nonce.action !== 'ISSUE_PRODUCT' || nonce.resource_id !== proof.payload.productId) {
    return fail('invalid_proof_nonce', 'This product signing request was not found.', 400)
  }
  if (nonce.wallet_address !== walletAddress || proof.payload.issuerAddress !== walletAddress) {
    return fail('issuer_mismatch', 'The signed product issuer does not match this wallet.', 401)
  }
  if (nonce.consumed_at) return fail('proof_nonce_consumed', 'This product was already published.', 409)
  if (Date.parse(nonce.expires_at) <= now.getTime()) {
    return fail('proof_expired', 'This product signing request expired. Review and sign again.', 410)
  }
  if (nonce.payload_hash !== proof.envelope.payloadHash) {
    return fail('payload_mismatch', 'The product details changed after review.', 400)
  }

  const verification = await verifySignedProof(proof, {
    action: 'ISSUE_PRODUCT',
    network,
    nonce: nonce.id,
    now,
    previousEventHash: null,
    signerAddress: walletAddress,
  })
  if (!verification.ok) {
    return fail(`invalid_product_proof:${verification.code}`, 'The product signature could not be verified.', 400)
  }

  try {
    await publishProduct(db, {
      envelopeJson: canonicalJson(proof.envelope),
      nonce: nonce.id,
      payload: proof.payload,
      payloadHash: proof.envelope.payloadHash,
      payloadJson: canonicalPayload(proof.payload),
      publicKey: proof.publicKey,
      signature: proof.signature,
    })
  } catch (error) {
    if (error instanceof Error && /proof_nonce_unavailable|product_versions_proof_nonce/i.test(error.message)) {
      return fail('proof_nonce_consumed', 'This product was already published.', 409)
    }
    if (error instanceof Error && /products\.issuer_address.*products\.serial_number_hash/i.test(error.message)) {
      return fail('serial_already_exists', 'This serial or reference was already issued.', 409)
    }
    throw error
  }

  return { id: proof.payload.productId, status: 'published', version: proof.payload.version }
}
