ALTER TABLE transfer_intents ADD COLUMN passport_version INTEGER NOT NULL DEFAULT 1 CHECK (passport_version >= 1);
ALTER TABLE transfer_intents ADD COLUMN owner_offer_public_key TEXT CHECK (owner_offer_public_key IS NULL OR length(owner_offer_public_key) BETWEEN 32 AND 256);
ALTER TABLE transfer_intents ADD COLUMN recipient_acceptance_public_key TEXT CHECK (recipient_acceptance_public_key IS NULL OR length(recipient_acceptance_public_key) BETWEEN 32 AND 256);

CREATE TRIGGER transfer_intents_require_offer_nonce
BEFORE INSERT ON transfer_intents
WHEN NOT EXISTS (
  SELECT 1 FROM proof_nonces
  WHERE proof_nonces.id = NEW.id
    AND proof_nonces.action = 'OFFER_TRANSFER'
    AND proof_nonces.resource_id = NEW.passport_id
    AND proof_nonces.wallet_address = NEW.from_address
    AND proof_nonces.payload_hash = (SELECT payload_hash FROM proof_nonces WHERE id = NEW.id)
    AND proof_nonces.consumed_at IS NULL
    AND proof_nonces.expires_at > NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'transfer_offer_nonce_unavailable'); END;

CREATE TRIGGER transfer_intents_consume_offer_nonce
AFTER INSERT ON transfer_intents
BEGIN
  UPDATE proof_nonces SET consumed_at = NEW.created_at WHERE id = NEW.id AND consumed_at IS NULL;
END;

DROP TRIGGER passport_events_advance_passport_head;
DROP TRIGGER passports_require_version_increment;
CREATE TRIGGER passports_require_version_increment BEFORE UPDATE ON passports
WHEN NOT (
  NEW.version = OLD.version + 1
  OR (
    NEW.version = OLD.version
    AND NEW.current_owner_address = OLD.current_owner_address
    AND NEW.head_event_hash <> OLD.head_event_hash
  )
)
BEGIN SELECT RAISE(ABORT, 'passport_version_must_increment_by_one'); END;

CREATE TRIGGER passport_events_advance_passport_head AFTER INSERT ON passport_events
BEGIN
  UPDATE passports
  SET head_event_hash = NEW.event_hash,
      status = CASE WHEN NEW.type = 'issued' THEN 'active' ELSE status END,
      version = version + CASE WHEN NEW.type = 'transferred' THEN 0 ELSE 1 END,
      updated_at = NEW.created_at
  WHERE id = NEW.passport_id;

  UPDATE products
  SET status = 'sold', updated_at = NEW.created_at
  WHERE id = (SELECT product_id FROM passports WHERE id = NEW.passport_id)
    AND NEW.type = 'issued' AND status = 'offered';
END;
