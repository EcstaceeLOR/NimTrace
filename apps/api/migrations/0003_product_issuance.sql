ALTER TABLE products ADD COLUMN price_luna INTEGER NOT NULL DEFAULT 1 CHECK (price_luna > 0);
ALTER TABLE products ADD COLUMN warranty_summary TEXT NOT NULL DEFAULT 'Not specified.'
  CHECK (length(warranty_summary) BETWEEN 1 AND 1000);

CREATE TABLE proof_nonces (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) BETWEEN 8 AND 64),
  action TEXT NOT NULL CHECK (action IN (
    'ISSUE_PRODUCT', 'UPDATE_PRODUCT', 'OFFER_TRANSFER', 'ACCEPT_TRANSFER',
    'CLAIM_WARRANTY', 'ATTEST_REPAIR', 'ACKNOWLEDGE_REPAIR'
  )),
  resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 8 AND 128),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  consumed_at TEXT CHECK (consumed_at IS NULL OR datetime(consumed_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
) STRICT;

CREATE INDEX proof_nonces_wallet_action ON proof_nonces (wallet_address, action, expires_at);

ALTER TABLE product_versions ADD COLUMN proof_envelope TEXT
  CHECK (proof_envelope IS NULL OR json_valid(proof_envelope));
ALTER TABLE product_versions ADD COLUMN proof_nonce TEXT REFERENCES proof_nonces(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX product_versions_proof_nonce_unique ON product_versions (proof_nonce)
  WHERE proof_nonce IS NOT NULL;

CREATE TRIGGER product_versions_require_available_nonce
BEFORE INSERT ON product_versions
WHEN NEW.proof_nonce IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM proof_nonces
  JOIN products ON products.id = NEW.product_id
  WHERE proof_nonces.id = NEW.proof_nonce
    AND proof_nonces.resource_id = NEW.product_id
    AND proof_nonces.wallet_address = products.issuer_address
    AND proof_nonces.action IN ('ISSUE_PRODUCT', 'UPDATE_PRODUCT')
    AND proof_nonces.payload_hash = NEW.payload_hash
    AND proof_nonces.consumed_at IS NULL
    AND proof_nonces.expires_at > NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'proof_nonce_unavailable');
END;

CREATE TRIGGER product_versions_consume_nonce
AFTER INSERT ON product_versions
WHEN NEW.proof_nonce IS NOT NULL
BEGIN
  UPDATE proof_nonces SET consumed_at = NEW.created_at
  WHERE id = NEW.proof_nonce AND consumed_at IS NULL;
END;
