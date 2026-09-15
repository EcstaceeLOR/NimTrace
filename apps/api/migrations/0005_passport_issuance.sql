CREATE TRIGGER passports_require_confirmed_initial_purchase
BEFORE INSERT ON passports
WHEN NEW.status <> 'suspended'
  OR NEW.head_event_hash IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM payment_intents
    JOIN products ON products.id = payment_intents.product_id
    JOIN product_versions
      ON product_versions.product_id = payment_intents.product_id
      AND product_versions.version = payment_intents.product_version
    WHERE payment_intents.id = NEW.purchase_intent_id
      AND payment_intents.purpose = 'initial_purchase'
      AND payment_intents.status = 'confirmed'
      AND payment_intents.product_id = NEW.product_id
      AND payment_intents.product_version = NEW.product_version
      AND payment_intents.buyer_address = NEW.current_owner_address
      AND payment_intents.confirmed_at = NEW.warranty_started_at
      AND products.status = 'offered'
      AND ABS(
        julianday(NEW.warranty_expires_at) - julianday(NEW.warranty_started_at)
        - products.warranty_duration_days
      ) < 0.000001
  )
BEGIN SELECT RAISE(ABORT, 'passport_requires_confirmed_initial_purchase'); END;

CREATE TRIGGER passport_issued_event_requires_purchase_evidence
BEFORE INSERT ON passport_events
WHEN NEW.type = 'issued' AND NOT EXISTS (
  SELECT 1
  FROM passports
  JOIN payment_intents ON payment_intents.id = passports.purchase_intent_id
  JOIN products ON products.id = passports.product_id
  JOIN product_versions
    ON product_versions.product_id = passports.product_id
    AND product_versions.version = passports.product_version
  WHERE passports.id = NEW.passport_id
    AND NEW.payment_intent_id = passports.purchase_intent_id
    AND payment_intents.status = 'confirmed'
    AND NEW.actor_address = products.issuer_address
    AND NEW.actor_public_key = product_versions.issuer_public_key
    AND NEW.actor_signature = product_versions.issuer_signature
)
BEGIN SELECT RAISE(ABORT, 'issued_event_requires_purchase_evidence'); END;

DROP TRIGGER passport_events_advance_passport_head;

CREATE TRIGGER passport_events_advance_passport_head AFTER INSERT ON passport_events
BEGIN
  UPDATE passports
  SET head_event_hash = NEW.event_hash,
      status = CASE WHEN NEW.type = 'issued' THEN 'active' ELSE status END,
      version = version + 1,
      updated_at = NEW.created_at
  WHERE id = NEW.passport_id;

  UPDATE products
  SET status = 'sold', updated_at = NEW.created_at
  WHERE id = (SELECT product_id FROM passports WHERE id = NEW.passport_id)
    AND NEW.type = 'issued' AND status = 'offered';
END;
