ALTER TABLE payment_intents ADD COLUMN product_version INTEGER NOT NULL DEFAULT 1
  CHECK (product_version >= 1);
ALTER TABLE payment_intents ADD COLUMN network TEXT NOT NULL DEFAULT 'main-albatross'
  CHECK (network IN ('main-albatross', 'test-albatross'));
ALTER TABLE payment_intents ADD COLUMN idempotency_key_hash TEXT
  CHECK (idempotency_key_hash IS NULL OR length(idempotency_key_hash) = 64);

CREATE UNIQUE INDEX payment_intents_buyer_idempotency_unique
  ON payment_intents (buyer_address, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE UNIQUE INDEX payment_intents_one_active_initial_purchase
  ON payment_intents (product_id)
  WHERE purpose = 'initial_purchase' AND status IN ('pending', 'submitted', 'confirmed');

CREATE TRIGGER payment_intents_require_server_bound_purchase
BEFORE INSERT ON payment_intents
WHEN NEW.purpose = 'initial_purchase' AND NEW.status = 'pending' AND (
  NEW.idempotency_key_hash IS NULL
  OR length(CAST(NEW.transaction_data AS BLOB)) > 64
  OR NEW.transaction_data GLOB '*[^A-Za-z0-9:_-]*'
  OR NOT EXISTS (
    SELECT 1
    FROM products
    JOIN product_versions
      ON product_versions.product_id = products.id
      AND product_versions.version = NEW.product_version
    WHERE products.id = NEW.product_id
      AND products.current_version = NEW.product_version
      AND products.issuer_address = NEW.seller_address
      AND products.price_luna = NEW.amount_luna
      AND products.status = 'offered'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'purchase_intent_values_not_server_bound');
END;

CREATE TRIGGER payment_intents_require_valid_transition
BEFORE UPDATE OF status ON payment_intents
WHEN OLD.status <> NEW.status AND NOT (
  OLD.status = 'pending' AND NEW.status IN ('submitted', 'expired', 'failed', 'cancelled')
  OR OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'failed')
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_payment_intent_transition');
END;

CREATE TRIGGER payment_intents_bound_values_are_immutable
BEFORE UPDATE OF
  purpose, product_id, product_version, seller_address, buyer_address,
  amount_luna, network, transaction_data, expires_at, idempotency_key_hash
ON payment_intents
WHEN
  OLD.purpose IS NOT NEW.purpose
  OR OLD.product_id IS NOT NEW.product_id
  OR OLD.product_version IS NOT NEW.product_version
  OR OLD.seller_address IS NOT NEW.seller_address
  OR OLD.buyer_address IS NOT NEW.buyer_address
  OR OLD.amount_luna IS NOT NEW.amount_luna
  OR OLD.network IS NOT NEW.network
  OR OLD.transaction_data IS NOT NEW.transaction_data
  OR OLD.expires_at IS NOT NEW.expires_at
  OR OLD.idempotency_key_hash IS NOT NEW.idempotency_key_hash
BEGIN
  SELECT RAISE(ABORT, 'payment_intent_values_are_immutable');
END;

CREATE TRIGGER payment_intents_transaction_hash_is_immutable
BEFORE UPDATE OF transaction_hash ON payment_intents
WHEN OLD.transaction_hash IS NOT NULL AND OLD.transaction_hash IS NOT NEW.transaction_hash
BEGIN
  SELECT RAISE(ABORT, 'payment_intent_transaction_hash_is_immutable');
END;

CREATE TRIGGER payment_intents_require_transition_evidence
BEFORE UPDATE ON payment_intents
WHEN
  (NEW.status = 'submitted' AND NEW.transaction_hash IS NULL)
  OR (NEW.status IN ('pending', 'expired', 'cancelled') AND NEW.transaction_hash IS NOT NULL)
  OR (NEW.status = 'confirmed' AND (
    NEW.transaction_hash IS NULL OR NEW.confirmed_block_height IS NULL OR NEW.confirmed_at IS NULL
  ))
  OR (NEW.status = 'failed' AND NEW.failure_code IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'payment_intent_transition_evidence_missing');
END;
