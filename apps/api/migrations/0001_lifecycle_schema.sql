PRAGMA foreign_keys = ON;

CREATE TABLE wallet_challenges (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) BETWEEN 8 AND 64),
  challenge_hash TEXT NOT NULL UNIQUE CHECK (length(challenge_hash) = 64),
  purpose TEXT NOT NULL DEFAULT 'authentication' CHECK (purpose IN ('authentication', 'merchant_enrollment')),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  consumed_at TEXT CHECK (consumed_at IS NULL OR datetime(consumed_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
) STRICT;

CREATE TABLE wallet_sessions (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL CHECK (length(wallet_address) BETWEEN 8 AND 64),
  challenge_id TEXT NOT NULL UNIQUE REFERENCES wallet_challenges(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  last_seen_at TEXT NOT NULL CHECK (datetime(last_seen_at) IS NOT NULL),
  revoked_at TEXT CHECK (revoked_at IS NULL OR datetime(revoked_at) IS NOT NULL),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE TABLE merchants (
  wallet_address TEXT PRIMARY KEY CHECK (length(wallet_address) BETWEEN 8 AND 64),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80),
  profile_slug TEXT NOT NULL UNIQUE CHECK (length(profile_slug) BETWEEN 3 AND 48 AND profile_slug = lower(profile_slug)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  issuer_address TEXT NOT NULL REFERENCES merchants(wallet_address) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  serial_number_hash TEXT CHECK (serial_number_hash IS NULL OR length(serial_number_hash) = 64),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  image_key TEXT CHECK (image_key IS NULL OR length(image_key) BETWEEN 1 AND 512),
  image_hash TEXT CHECK (image_hash IS NULL OR length(image_hash) = 64),
  warranty_duration_days INTEGER NOT NULL DEFAULT 0 CHECK (warranty_duration_days BETWEEN 0 AND 36500),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'offered', 'sold', 'suspended', 'retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((image_key IS NULL) = (image_hash IS NULL)),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX products_issuer_serial_unique ON products (issuer_address, serial_number_hash)
  WHERE serial_number_hash IS NOT NULL;

CREATE TABLE product_versions (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version >= 1),
  canonical_payload TEXT NOT NULL CHECK (json_valid(canonical_payload)),
  payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64),
  issuer_public_key TEXT NOT NULL CHECK (length(issuer_public_key) BETWEEN 32 AND 256),
  issuer_signature TEXT NOT NULL CHECK (length(issuer_signature) BETWEEN 64 AND 512),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (product_id, version)
) STRICT;

CREATE TRIGGER product_versions_require_next_version BEFORE INSERT ON product_versions
WHEN NEW.version != COALESCE((SELECT current_version + 1 FROM products WHERE id = NEW.product_id), -1)
BEGIN SELECT RAISE(ABORT, 'product_version_must_be_sequential'); END;

CREATE TRIGGER product_versions_advance_product AFTER INSERT ON product_versions
BEGIN
  UPDATE products SET current_version = NEW.version, updated_at = NEW.created_at WHERE id = NEW.product_id;
END;

CREATE TRIGGER product_versions_are_immutable_on_update BEFORE UPDATE ON product_versions
BEGIN SELECT RAISE(ABORT, 'product_versions_are_immutable'); END;

CREATE TRIGGER product_versions_are_immutable_on_delete BEFORE DELETE ON product_versions
BEGIN SELECT RAISE(ABORT, 'product_versions_are_immutable'); END;

CREATE TABLE payment_intents (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('initial_purchase', 'resale')),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  passport_id TEXT REFERENCES passports(id) ON DELETE RESTRICT,
  seller_address TEXT NOT NULL CHECK (length(seller_address) BETWEEN 8 AND 64),
  buyer_address TEXT NOT NULL CHECK (length(buyer_address) BETWEEN 8 AND 64),
  amount_luna INTEGER NOT NULL CHECK (amount_luna > 0),
  transaction_data TEXT NOT NULL UNIQUE CHECK (length(transaction_data) BETWEEN 8 AND 128),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'expired', 'failed', 'cancelled')),
  transaction_hash TEXT UNIQUE CHECK (transaction_hash IS NULL OR length(transaction_hash) BETWEEN 32 AND 128),
  confirmed_block_height INTEGER CHECK (confirmed_block_height IS NULL OR confirmed_block_height >= 0),
  confirmed_at TEXT CHECK (confirmed_at IS NULL OR datetime(confirmed_at) IS NOT NULL),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (seller_address <> buyer_address),
  CHECK ((purpose = 'initial_purchase' AND passport_id IS NULL) OR (purpose = 'resale' AND passport_id IS NOT NULL)),
  CHECK (status <> 'confirmed' OR (transaction_hash IS NOT NULL AND confirmed_block_height IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (expires_at > created_at AND updated_at >= created_at)
) STRICT;

CREATE INDEX payment_intents_buyer_status ON payment_intents (buyer_address, status);
CREATE INDEX payment_intents_seller_status ON payment_intents (seller_address, status);
CREATE INDEX payment_intents_expiry ON payment_intents (status, expires_at);

CREATE TABLE passports (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  product_version INTEGER NOT NULL CHECK (product_version >= 1),
  current_owner_address TEXT NOT NULL CHECK (length(current_owner_address) BETWEEN 8 AND 64),
  purchase_intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id) ON DELETE RESTRICT,
  warranty_started_at TEXT NOT NULL CHECK (datetime(warranty_started_at) IS NOT NULL),
  warranty_expires_at TEXT NOT NULL CHECK (datetime(warranty_expires_at) IS NOT NULL),
  head_event_hash TEXT UNIQUE CHECK (head_event_hash IS NULL OR length(head_event_hash) = 64),
  status TEXT NOT NULL DEFAULT 'suspended' CHECK (status IN ('active', 'transfer_pending', 'suspended', 'retired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (product_id, product_version) REFERENCES product_versions(product_id, version) ON DELETE RESTRICT,
  CHECK (warranty_expires_at >= warranty_started_at),
  CHECK (status <> 'active' OR head_event_hash IS NOT NULL),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX passports_owner_status ON passports (current_owner_address, status);

CREATE TRIGGER passports_require_version_increment BEFORE UPDATE ON passports
WHEN NEW.version != OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'passport_version_must_increment_by_one'); END;

CREATE TABLE passport_events (
  id TEXT PRIMARY KEY,
  passport_id TEXT NOT NULL REFERENCES passports(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  type TEXT NOT NULL CHECK (type IN ('issued', 'transferred', 'repaired', 'warranty_claimed', 'corrected', 'retired')),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR length(previous_event_hash) = 64),
  canonical_payload TEXT NOT NULL CHECK (json_valid(canonical_payload)),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64),
  actor_address TEXT NOT NULL CHECK (length(actor_address) BETWEEN 8 AND 64),
  actor_public_key TEXT NOT NULL CHECK (length(actor_public_key) BETWEEN 32 AND 256),
  actor_signature TEXT NOT NULL CHECK (length(actor_signature) BETWEEN 64 AND 512),
  payment_intent_id TEXT UNIQUE REFERENCES payment_intents(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (passport_id, sequence),
  CHECK ((sequence = 1 AND previous_event_hash IS NULL AND type = 'issued') OR
         (sequence > 1 AND previous_event_hash IS NOT NULL AND type <> 'issued'))
) STRICT;

CREATE TRIGGER passport_events_require_next_link BEFORE INSERT ON passport_events
WHEN NEW.sequence != COALESCE((SELECT MAX(sequence) + 1 FROM passport_events WHERE passport_id = NEW.passport_id), 1)
  OR (NEW.sequence > 1 AND NEW.previous_event_hash !=
      (SELECT event_hash FROM passport_events WHERE passport_id = NEW.passport_id ORDER BY sequence DESC LIMIT 1))
BEGIN SELECT RAISE(ABORT, 'passport_event_chain_is_invalid'); END;

CREATE TRIGGER passport_events_advance_passport_head AFTER INSERT ON passport_events
BEGIN
  UPDATE passports SET head_event_hash = NEW.event_hash, version = version + 1, updated_at = NEW.created_at
  WHERE id = NEW.passport_id;
END;

CREATE TRIGGER passport_events_are_immutable_on_update BEFORE UPDATE ON passport_events
BEGIN SELECT RAISE(ABORT, 'passport_events_are_immutable'); END;

CREATE TRIGGER passport_events_are_immutable_on_delete BEFORE DELETE ON passport_events
BEGIN SELECT RAISE(ABORT, 'passport_events_are_immutable'); END;

CREATE TABLE transfer_intents (
  id TEXT PRIMARY KEY,
  passport_id TEXT NOT NULL REFERENCES passports(id) ON DELETE RESTRICT,
  from_address TEXT NOT NULL CHECK (length(from_address) BETWEEN 8 AND 64),
  to_address TEXT NOT NULL CHECK (length(to_address) BETWEEN 8 AND 64),
  price_luna INTEGER NOT NULL DEFAULT 0 CHECK (price_luna >= 0),
  expires_at TEXT NOT NULL CHECK (datetime(expires_at) IS NOT NULL),
  owner_offer_signature TEXT NOT NULL CHECK (length(owner_offer_signature) BETWEEN 64 AND 512),
  recipient_acceptance_signature TEXT CHECK (recipient_acceptance_signature IS NULL OR length(recipient_acceptance_signature) BETWEEN 64 AND 512),
  payment_intent_id TEXT UNIQUE REFERENCES payment_intents(id) ON DELETE RESTRICT,
  resulting_event_id TEXT UNIQUE REFERENCES passport_events(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_recipient' CHECK (status IN ('pending_recipient', 'payment_pending', 'accepted', 'completed', 'expired', 'cancelled', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_address <> to_address),
  CHECK ((price_luna = 0 AND payment_intent_id IS NULL) OR (price_luna > 0 AND payment_intent_id IS NOT NULL)),
  CHECK (status NOT IN ('payment_pending', 'accepted', 'completed') OR recipient_acceptance_signature IS NOT NULL),
  CHECK (status <> 'completed' OR resulting_event_id IS NOT NULL),
  CHECK (expires_at > created_at AND updated_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX transfer_intents_one_active_per_passport ON transfer_intents (passport_id)
  WHERE status IN ('pending_recipient', 'payment_pending', 'accepted');
CREATE INDEX transfer_intents_recipient_status ON transfer_intents (to_address, status);

CREATE TABLE repair_attestations (
  id TEXT PRIMARY KEY,
  passport_id TEXT NOT NULL REFERENCES passports(id) ON DELETE RESTRICT,
  repairer_address TEXT NOT NULL CHECK (length(repairer_address) BETWEEN 8 AND 64),
  service_type TEXT NOT NULL CHECK (length(service_type) BETWEEN 1 AND 80),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  serviced_at TEXT NOT NULL CHECK (datetime(serviced_at) IS NOT NULL),
  evidence_hash TEXT CHECK (evidence_hash IS NULL OR length(evidence_hash) = 64),
  canonical_payload TEXT NOT NULL CHECK (json_valid(canonical_payload)),
  payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64),
  repairer_public_key TEXT NOT NULL CHECK (length(repairer_public_key) BETWEEN 32 AND 256),
  repairer_signature TEXT NOT NULL CHECK (length(repairer_signature) BETWEEN 64 AND 512),
  owner_address TEXT CHECK (owner_address IS NULL OR length(owner_address) BETWEEN 8 AND 64),
  owner_public_key TEXT CHECK (owner_public_key IS NULL OR length(owner_public_key) BETWEEN 32 AND 256),
  owner_signature TEXT CHECK (owner_signature IS NULL OR length(owner_signature) BETWEEN 64 AND 512),
  resulting_event_id TEXT UNIQUE REFERENCES passport_events(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_owner' CHECK (status IN ('pending_owner', 'acknowledged', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((owner_address IS NULL AND owner_public_key IS NULL AND owner_signature IS NULL) OR
         (owner_address IS NOT NULL AND owner_public_key IS NOT NULL AND owner_signature IS NOT NULL)),
  CHECK (status = 'pending_owner' OR owner_signature IS NOT NULL),
  CHECK (status <> 'acknowledged' OR resulting_event_id IS NOT NULL),
  CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX repair_attestations_passport_service ON repair_attestations (passport_id, serviced_at DESC);

CREATE TRIGGER acknowledged_repairs_are_immutable BEFORE UPDATE ON repair_attestations
WHEN OLD.status = 'acknowledged'
BEGIN SELECT RAISE(ABORT, 'acknowledged_repairs_are_immutable'); END;

CREATE TRIGGER acknowledged_repairs_cannot_be_deleted BEFORE DELETE ON repair_attestations
WHEN OLD.status = 'acknowledged'
BEGIN SELECT RAISE(ABORT, 'acknowledged_repairs_are_immutable'); END;
