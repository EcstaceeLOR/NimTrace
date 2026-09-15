import {
  IssuedPassportEventPayloadSchema,
  canonicalJson,
  canonicalPayload,
  sha256Hex,
  PassportCollectionResponseSchema,
  PassportDetailSchema,
  PassportSummarySchema,
  type IssuedPassportEventPayload,
  type IssuedPassportResponse,
  type NimiqNetwork,
  type PassportSummary,
} from '@nimtrace/contracts'
import { randomToken } from '../auth/crypto'
import { DEMO_IMAGE_KEY } from '../images/service'
import { getPublicProduct } from '../products/public'
import {
  createPassportIssuanceBatch,
  findIssuedPassportByIntent,
  findPassportIssuanceMaterial,
  passportResponse,
  findWalletPassportDetail,
  listPassportEvents,
  listWalletPassportAccess,
  type PassportDetailRecord,
  type StoredIssuedPassport,
} from './repository'

interface VerifiedPurchaseEvidence {
  blockHeight: number
  confirmedAt: string
  transactionHash: string
}

export class PassportIssuanceError extends Error {
  constructor(
    readonly code: 'payment_not_confirmed' | 'payment_not_found' | 'passport_audit_invalid',
    message: string,
    readonly status: 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class PassportCollectionError extends Error {}

function eventHashInput(
  passportId: string,
  payloadHash: string,
) {
  return canonicalJson({
    passportId,
    payloadHash,
    previousEventHash: null,
    sequence: 1,
    type: 'issued',
    version: 1,
  })
}

export async function computeFirstPassportEventHash(
  passportId: string,
  payloadHash: string,
) {
  return sha256Hex(eventHashInput(passportId, payloadHash))
}

function parsedIssuedPayload(canonical: string) {
  try {
    const wrapper = JSON.parse(canonical) as { data?: unknown; version?: unknown }
    if (wrapper.version !== 1) return null
    const payload = IssuedPassportEventPayloadSchema.safeParse(wrapper.data)
    if (!payload.success || canonicalPayload(payload.data) !== canonical) return null
    return payload.data
  } catch {
    return null
  }
}

export async function validateFirstPassportEvent(record: StoredIssuedPassport) {
  if (record.eventSequence !== 1
    || record.eventType !== 'issued'
    || record.eventPreviousHash !== null) return false

  const payload = parsedIssuedPayload(record.canonicalPayload)
  if (!payload) return false
  if (await sha256Hex(record.canonicalPayload) !== record.eventPayloadHash) return false
  if (await computeFirstPassportEventHash(record.id, record.eventPayloadHash) !== record.eventHash) return false

  return payload.passportId === record.id
    && payload.ownerAddress === record.purchaseBuyerAddress
    && payload.payment.intentId === record.purchaseIntentId
    && payload.payment.transactionHash === record.purchaseTransactionHash
    && payload.payment.blockHeight === record.purchaseBlockHeight
    && payload.payment.confirmedAt === record.purchaseConfirmedAt
    && payload.product.id === record.productId
    && payload.product.version === record.productVersion
    && payload.product.payloadHash === record.productPayloadHash
    && payload.warranty.startedAt === record.warrantyStartedAt
    && payload.warranty.expiresAt === record.warrantyExpiresAt
}

async function verifiedResponse(db: D1Database, intentId: string) {
  const record = await findIssuedPassportByIntent(db, intentId)
  if (!record || !await validateFirstPassportEvent(record)) {
    throw new PassportIssuanceError(
      'passport_audit_invalid',
      'The passport issuance audit chain is incomplete or invalid.',
      500,
    )
  }
  return passportResponse(record)
}

export async function issuePassportForConfirmedPurchase(
  db: D1Database,
  intentId: string,
  evidence?: VerifiedPurchaseEvidence,
  expectedBuyerAddress?: string,
  now = new Date(),
): Promise<IssuedPassportResponse> {
  const material = await findPassportIssuanceMaterial(db, intentId)
  if (!material || (expectedBuyerAddress && material.buyerAddress !== expectedBuyerAddress)) {
    throw new PassportIssuanceError('payment_not_found', 'This confirmed payment was not found.', 404)
  }

  const existing = await findIssuedPassportByIntent(db, intentId)
  if (existing) return verifiedResponse(db, intentId)

  let confirmedAt = material.confirmedAt
  let confirmedBlockHeight = material.confirmedBlockHeight
  if (material.paymentStatus === 'submitted' && evidence
    && material.transactionHash === evidence.transactionHash) {
    confirmedAt = evidence.confirmedAt
    confirmedBlockHeight = evidence.blockHeight
  }
  if ((material.paymentStatus !== 'submitted' && material.paymentStatus !== 'confirmed')
    || !material.transactionHash
    || confirmedAt === null
    || confirmedBlockHeight === null) {
    throw new PassportIssuanceError(
      'payment_not_confirmed',
      'Independent final payment evidence is required before passport issuance.',
      409,
    )
  }

  const passportId = randomToken(18)
  const eventId = randomToken(18)
  const warrantyStartedAt = confirmedAt
  const warrantyExpiresAt = new Date(
    Date.parse(warrantyStartedAt) + material.warrantyDurationDays * 86_400_000,
  ).toISOString()
  const eventPayload: IssuedPassportEventPayload = IssuedPassportEventPayloadSchema.parse({
    eventType: 'issued',
    ownerAddress: material.buyerAddress,
    passportId,
    payment: {
      blockHeight: confirmedBlockHeight,
      confirmedAt,
      intentId,
      transactionHash: material.transactionHash,
    },
    product: {
      id: material.productId,
      payloadHash: material.productPayloadHash,
      version: material.productVersion,
    },
    warranty: { expiresAt: warrantyExpiresAt, startedAt: warrantyStartedAt },
  })
  const eventPayloadJson = canonicalPayload(eventPayload)
  const eventPayloadHash = await sha256Hex(eventPayloadJson)
  const eventHash = await computeFirstPassportEventHash(passportId, eventPayloadHash)

  try {
    await createPassportIssuanceBatch(db, material, {
      confirmedAt,
      confirmedBlockHeight,
      createdAt: now.toISOString(),
      eventHash,
      eventId,
      eventPayload: eventPayloadJson,
      eventPayloadHash,
      intentId,
      passportId,
      transactionHash: material.transactionHash,
      warrantyExpiresAt,
    })
  } catch (error) {
    // Concurrent/replayed completion loses the unique product/payment race but
    // returns the winner. Any other failure remains visible and D1 rolls the
    // entire batch back.
    if (await findIssuedPassportByIntent(db, intentId)) return verifiedResponse(db, intentId)
    throw error
  }

  return verifiedResponse(db, intentId)
}

function warrantyProjection(record: PassportDetailRecord, now: Date) {
  if (record.warrantyDurationDays === 0) {
    return { warrantyDaysRemaining: 0, warrantyState: 'none' as const }
  }
  const remaining = Math.max(0, Math.ceil((Date.parse(record.warrantyExpiresAt) - now.getTime()) / 86_400_000))
  return {
    warrantyDaysRemaining: remaining,
    warrantyState: remaining > 0 ? 'active' as const : 'expired' as const,
  }
}

async function passportProjection(
  db: D1Database,
  record: PassportDetailRecord,
  network: NimiqNetwork,
  now: Date,
): Promise<PassportSummary> {
  const product = await getPublicProduct(db, record.productId, network, record.productVersion)
  const auditRecord = await findIssuedPassportByIntent(db, record.purchaseIntentId)
  const auditVerified = Boolean(auditRecord && await validateFirstPassportEvent(auditRecord))
  const imageKey = record.imageKey ?? DEMO_IMAGE_KEY
  return PassportSummarySchema.parse({
    auditState: auditVerified && product.signatureState === 'verified' ? 'verified' : 'invalid',
    currentOwnerAddress: record.currentOwnerAddress,
    id: record.id,
    imageUrl: imageKey === DEMO_IMAGE_KEY
      ? '/demo-product.svg'
      : `/api/product-images?key=${encodeURIComponent(imageKey)}`,
    issuerAddress: record.issuerAddress,
    issuedAt: record.issuedAt,
    ownership: record.ownership,
    productId: record.productId,
    productTitle: product.title,
    productVersion: record.productVersion,
    recentlyIssued: record.ownership === 'current'
      && now.getTime() >= Date.parse(record.issuedAt)
      && now.getTime() - Date.parse(record.issuedAt) < 10 * 60_000,
    status: record.status,
    warrantyExpiresAt: record.warrantyExpiresAt,
    ...warrantyProjection(record, now),
  })
}

export async function listWalletPassports(
  db: D1Database,
  walletAddress: string,
  network: NimiqNetwork,
  includeHistory = false,
  now = new Date(),
) {
  const access = await listWalletPassportAccess(db, walletAddress, includeHistory)
  const items: PassportSummary[] = []
  for (const item of access) {
    const record = await findWalletPassportDetail(db, item.id, walletAddress)
    if (record) items.push(await passportProjection(db, record, network, now))
  }
  return PassportCollectionResponseSchema.parse({ items })
}

export async function getWalletPassport(
  db: D1Database,
  passportId: string,
  walletAddress: string,
  network: NimiqNetwork,
  origin: string,
  now = new Date(),
) {
  const record = await findWalletPassportDetail(db, passportId, walletAddress)
  if (!record) throw new PassportCollectionError('Passport not found.')
  const summary = await passportProjection(db, record, network, now)
  const signedProduct = await getPublicProduct(db, record.productId, network, record.productVersion)
  const events = await listPassportEvents(db, passportId)
  return PassportDetailSchema.parse({
    ...summary,
    description: signedProduct.description,
    events,
    headEventHash: record.headEventHash,
    ownerActions: record.ownership === 'current' && record.status === 'active'
      ? summary.warrantyState === 'active' ? ['transfer', 'present_warranty'] : ['transfer']
      : [],
    productProofHash: (await findIssuedPassportByIntent(db, record.purchaseIntentId))!.productPayloadHash,
    publicUrl: `${origin}/passports/${encodeURIComponent(passportId)}`,
    purchaseBlockHeight: record.purchaseBlockHeight,
    purchaseConfirmedAt: record.purchaseConfirmedAt,
    purchaseIntentId: record.purchaseIntentId,
    purchaseTransactionHash: record.purchaseTransactionHash,
    warrantyStartedAt: record.warrantyStartedAt,
    warrantySummary: signedProduct.warrantySummary,
  })
}
