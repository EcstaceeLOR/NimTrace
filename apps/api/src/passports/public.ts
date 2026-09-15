import {
  PublicPassportVerificationSchema,
  canonicalJson,
  sha256Hex,
  type NimiqNetwork,
  type PublicPassportVerification,
} from '@nimtrace/contracts'
import { DEMO_IMAGE_KEY } from '../images/service'
import { findPaymentIntent } from '../payments/repository'
import type { NimiqRpcClient } from '../payments/rpc'
import { verifyStoredPaymentIntent } from '../payments/verification'
import { getPublicProduct } from '../products/public'
import {
  findPublicPassportDetail,
  findIssuedPassportByIntent,
  listPassportAuditEvents,
  type PassportAuditEventRecord,
} from './repository'
import { computePassportEventHash, validateFirstPassportEvent } from './service'

export class PublicPassportError extends Error {}

function maskOwner(address: string) {
  const compact = address.replaceAll(' ', '')
  return `${compact.slice(0, 6)}••••••${compact.slice(-6)}`
}

function publicEvent(event: PassportAuditEventRecord) {
  return {
    createdAt: event.createdAt,
    eventHash: event.eventHash,
    maskedActor: maskOwner(event.actorAddress),
    previousEventHash: event.previousEventHash,
    sequence: event.sequence,
    type: event.type,
  }
}

export async function validatePassportEventChain(
  passportId: string,
  expectedHead: string,
  events: PassportAuditEventRecord[],
) {
  if (events.length === 0 || events[0]?.sequence !== 1
    || events[0]?.type !== 'issued' || events[0]?.previousEventHash !== null) return false

  let previousHash: string | null = null
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.sequence !== index + 1 || event.previousEventHash !== previousHash) return false
    try {
      if (canonicalJson(JSON.parse(event.canonicalPayload)) !== event.canonicalPayload) return false
    } catch {
      return false
    }
    if (await sha256Hex(event.canonicalPayload) !== event.payloadHash) return false
    const eventHash = await computePassportEventHash(
      passportId,
      event.payloadHash,
      event.previousEventHash,
      event.sequence,
      event.type,
    )
    if (eventHash !== event.eventHash) return false
    previousHash = event.eventHash
  }
  return previousHash === expectedHead
}

function purchaseEvidenceState(state: 'verified' | 'pending' | 'rejected' | 'inconclusive') {
  if (state === 'verified') return 'verified' as const
  if (state === 'rejected') return 'unverified' as const
  return 'partial' as const
}

export async function getPublicPassportVerification(
  db: D1Database,
  passportId: string,
  network: NimiqNetwork,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  origin: string,
  now = new Date(),
): Promise<PublicPassportVerification> {
  const record = await findPublicPassportDetail(db, passportId)
  if (!record) throw new PublicPassportError('Passport not found.')
  const payment = await findPaymentIntent(db, record.purchaseIntentId)
  if (!payment || !payment.transactionHash) throw new PublicPassportError('Passport payment evidence is missing.')

  const [product, events, issuanceAudit, purchaseVerification] = await Promise.all([
    getPublicProduct(db, record.productId, network, record.productVersion),
    listPassportAuditEvents(db, passportId),
    findIssuedPassportByIntent(db, record.purchaseIntentId),
    verifyStoredPaymentIntent({
      ...payment,
      intent: { ...payment.intent, status: 'submitted' },
    }, rpc, now),
  ])
  const eventChainVerified = await validatePassportEventChain(passportId, record.headEventHash, events)
    && Boolean(issuanceAudit && await validateFirstPassportEvent(issuanceAudit))
  const productVerified = product.signatureState === 'verified'
  const purchaseState = purchaseEvidenceState(purchaseVerification.state)
  const overallState = !productVerified || !eventChainVerified || purchaseState === 'unverified'
    ? 'unverified'
    : purchaseState === 'partial'
      ? 'partially_verified'
      : 'verified'
  const daysRemaining = record.warrantyDurationDays === 0
    ? 0
    : Math.max(0, Math.ceil((Date.parse(record.warrantyExpiresAt) - now.getTime()) / 86_400_000))
  const imageKey = record.imageKey ?? DEMO_IMAGE_KEY

  return PublicPassportVerificationSchema.parse({
    checkedAt: now.toISOString(),
    eventChain: {
      eventCount: events.length,
      events: events.map(publicEvent),
      headEventHash: record.headEventHash,
      state: eventChainVerified ? 'verified' : 'unverified',
    },
    id: record.id,
    merchantClaims: {
      description: product.description,
      warrantySummary: product.warrantySummary,
    },
    overallState,
    ownership: {
      maskedCurrentOwner: maskOwner(record.currentOwnerAddress),
      state: eventChainVerified ? 'verified' : 'unverified',
    },
    product: {
      imageUrl: imageKey === DEMO_IMAGE_KEY
        ? '/demo-product.svg'
        : `/api/product-images?key=${encodeURIComponent(imageKey)}`,
      issuerAddress: product.issuerAddress,
      payloadHash: product.proofHash,
      state: productVerified ? 'verified' : 'unverified',
      title: product.title,
      version: product.version,
    },
    publicUrl: `${origin}/passports/${encodeURIComponent(passportId)}`,
    purchase: {
      blockHeight: record.purchaseBlockHeight,
      confirmedAt: record.purchaseConfirmedAt,
      reason: purchaseVerification.reason,
      state: purchaseState,
      transactionHash: record.purchaseTransactionHash,
    },
    status: record.status,
    warranty: {
      daysRemaining,
      expiresAt: record.warrantyExpiresAt,
      startedAt: record.warrantyStartedAt,
      state: record.warrantyDurationDays === 0 ? 'none' : daysRemaining > 0 ? 'active' : 'expired',
    },
  })
}
