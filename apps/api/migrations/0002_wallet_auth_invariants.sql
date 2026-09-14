CREATE TRIGGER wallet_sessions_require_available_challenge
BEFORE INSERT ON wallet_sessions
WHEN NOT EXISTS (
  SELECT 1
  FROM wallet_challenges
  WHERE id = NEW.challenge_id
    AND wallet_address = NEW.wallet_address
    AND purpose = 'authentication'
    AND consumed_at IS NULL
    AND expires_at > NEW.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'challenge_unavailable');
END;

CREATE TRIGGER wallet_sessions_consume_challenge
AFTER INSERT ON wallet_sessions
BEGIN
  UPDATE wallet_challenges
  SET consumed_at = NEW.created_at
  WHERE id = NEW.challenge_id AND consumed_at IS NULL;
END;
