CREATE TABLE warranty_presentations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 24 AND 128),
  passport_id TEXT NOT NULL REFERENCES passports(id) ON DELETE RESTRICT,
  owner_address TEXT NOT NULL CHECK (length(owner_address) BETWEEN 8 AND 64),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  created_at TEXT NOT NULL CHECK (datetime(created_at) IS NOT NULL),
  CHECK (expires_at > created_at)
) STRICT;

CREATE INDEX warranty_presentations_expiry ON warranty_presentations (expires_at);
