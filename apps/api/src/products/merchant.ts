import { MerchantProductListResponseSchema, type MerchantProductSummary } from '@nimtrace/contracts'

interface MerchantProductRow {
  id: string
  title: string
  price_luna: number
  warranty_duration_days: number
  warranty_summary: string
  product_status: 'offered' | 'sold' | 'suspended' | 'retired'
  issued_at: string
  passport_id: string | null
  passport_status: 'active' | 'transfer_pending' | 'suspended' | 'retired' | null
  current_owner_address: string | null
}

function maskAddress(address: string | null) {
  if (!address) return null
  const compact = address.replaceAll(' ', '')
  return `${compact.slice(0, 6)}…${compact.slice(-6)}`
}

export async function listMerchantProducts(db: D1Database, walletAddress: string) {
  const rows = await db.prepare(`
    SELECT
      products.id,
      products.title,
      products.price_luna,
      products.warranty_duration_days,
      products.warranty_summary,
      products.status AS product_status,
      product_versions.created_at AS issued_at,
      passports.id AS passport_id,
      passports.status AS passport_status,
      passports.current_owner_address
    FROM products
    JOIN product_versions ON product_versions.product_id = products.id
      AND product_versions.version = products.current_version
    LEFT JOIN passports ON passports.product_id = products.id
    WHERE products.issuer_address = ?
    ORDER BY products.updated_at DESC, products.id DESC
  `).bind(walletAddress).all<MerchantProductRow>()

  const items: MerchantProductSummary[] = rows.results.map((row) => ({
    id: row.id,
    issuedAt: row.issued_at,
    passportId: row.passport_id,
    passportStatus: row.passport_status,
    priceLuna: row.price_luna,
    purchaserMasked: maskAddress(row.current_owner_address),
    state: row.product_status === 'offered' ? 'available' : row.product_status === 'sold' ? 'owned' : row.product_status,
    title: row.title,
    warrantyDurationDays: row.warranty_duration_days,
    warrantySummary: row.warranty_summary,
  }))

  return MerchantProductListResponseSchema.parse({ items })
}
