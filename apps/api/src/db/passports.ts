export interface UpdatePassportOwnerInput {
  passportId: string
  expectedVersion: number
  currentOwnerAddress: string
  status: 'active' | 'transfer_pending' | 'suspended' | 'retired'
  updatedAt: string
}

export interface PassportRecord {
  id: string
  currentOwnerAddress: string
  status: string
  version: number
  headEventHash: string | null
}

interface PassportRow {
  id: string
  current_owner_address: string
  status: string
  version: number
  head_event_hash: string | null
}

export const UPDATE_PASSPORT_OWNER_SQL = `
  UPDATE passports
  SET current_owner_address = ?1,
      status = ?2,
      version = version + 1,
      updated_at = ?3
  WHERE id = ?4 AND version = ?5
  RETURNING id, current_owner_address, status, version, head_event_hash
`

export async function updatePassportOwner(
  database: D1Database,
  input: UpdatePassportOwnerInput,
): Promise<PassportRecord | null> {
  const row = await database
    .prepare(UPDATE_PASSPORT_OWNER_SQL)
    .bind(
      input.currentOwnerAddress,
      input.status,
      input.updatedAt,
      input.passportId,
      input.expectedVersion,
    )
    .first<PassportRow>()

  if (!row) return null

  return {
    id: row.id,
    currentOwnerAddress: row.current_owner_address,
    status: row.status,
    version: row.version,
    headEventHash: row.head_event_hash,
  }
}
