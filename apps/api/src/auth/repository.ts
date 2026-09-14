export interface WalletChallengeRow {
  challenge_hash: string
  consumed_at: string | null
  created_at: string
  expires_at: string
  id: string
  wallet_address: string
}

export async function insertChallenge(
  db: D1Database,
  challenge: WalletChallengeRow,
): Promise<void> {
  await db.prepare(`
    INSERT INTO wallet_challenges (
      id, wallet_address, challenge_hash, purpose, expires_at, consumed_at, created_at
    ) VALUES (?, ?, ?, 'authentication', ?, NULL, ?)
  `).bind(
    challenge.id,
    challenge.wallet_address,
    challenge.challenge_hash,
    challenge.expires_at,
    challenge.created_at,
  ).run()
}

export async function findChallenge(
  db: D1Database,
  challengeId: string,
): Promise<WalletChallengeRow | null> {
  return db.prepare(`
    SELECT id, wallet_address, challenge_hash, expires_at, consumed_at, created_at
    FROM wallet_challenges
    WHERE id = ? AND purpose = 'authentication'
  `).bind(challengeId).first<WalletChallengeRow>()
}

interface WalletSessionRow {
  challengeId: string
  createdAt: string
  expiresAt: string
  id: string
  tokenHash: string
  walletAddress: string
}

export async function insertSession(db: D1Database, session: WalletSessionRow): Promise<void> {
  await db.prepare(`
    INSERT INTO wallet_sessions (
      id, wallet_address, challenge_id, token_hash, expires_at, last_seen_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    session.id,
    session.walletAddress,
    session.challengeId,
    session.tokenHash,
    session.expiresAt,
    session.createdAt,
    session.createdAt,
  ).run()
}
