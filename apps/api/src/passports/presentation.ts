import {
  MerchantWarrantyPresentationSchema,
  WarrantyPresentationResponseSchema,
  type NimiqNetwork,
  type WarrantyPresentationResponse,
} from '@nimtrace/contracts'
import { randomToken } from '../auth/crypto'
import type { NimiqRpcClient } from '../payments/rpc'
import { getPublicPassportVerification, PublicPassportError } from './public'
import { findWalletPassportDetail } from './repository'

const PRESENTATION_TTL_MS = 5 * 60 * 1000

interface PresentationRow { expires_at: string; owner_address: string; passport_id: string }

export async function createWarrantyPresentation(
  db: D1Database,
  passportId: string,
  ownerAddress: string,
  origin: string,
  now = new Date(),
): Promise<WarrantyPresentationResponse> {
  const passport = await findWalletPassportDetail(db, passportId, ownerAddress)
  if (!passport || passport.currentOwnerAddress !== ownerAddress) throw new PublicPassportError('Only the current owner can present this passport.')
  const id = randomToken(24)
  const expiresAt = new Date(now.getTime() + PRESENTATION_TTL_MS).toISOString()
  await db.prepare(`
    INSERT INTO warranty_presentations (id, passport_id, owner_address, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, passportId, ownerAddress, expiresAt, now.toISOString()).run()
  return WarrantyPresentationResponseSchema.parse({
    expiresAt,
    passportId,
    url: `${origin}/presentations/${encodeURIComponent(id)}`,
  })
}

export async function getWarrantyPresentation(
  db: D1Database,
  token: string,
  network: NimiqNetwork,
  rpc: Pick<NimiqRpcClient, 'getTransaction'>,
  origin: string,
  now = new Date(),
) {
  const row = await db.prepare(`
    SELECT passport_id, owner_address, expires_at
    FROM warranty_presentations WHERE id = ? AND expires_at > ?
  `).bind(token, now.toISOString()).first<PresentationRow>()
  if (!row) throw new PublicPassportError('This merchant presentation has expired or does not exist.')
  const passport = await getPublicPassportVerification(db, row.passport_id, network, rpc, origin, now)
  return MerchantWarrantyPresentationSchema.parse({
    expiresAt: row.expires_at,
    passport,
    presentationType: 'merchant_view',
  })
}
