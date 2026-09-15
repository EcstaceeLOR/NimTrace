# Wallet-owned passport collection

The authenticated passport collection is the durable home for products a wallet
owns. It is not populated from browser state or a manual “add” action; every
card is projected from an issued passport backed by confirmed payment evidence.

## API boundary

```http
GET /api/passports
Authorization: Bearer <wallet-session>

GET /api/passports/<passport-id>
Authorization: Bearer <wallet-session>
```

By default the collection returns only rows whose `current_owner_address`
matches the authenticated wallet. `?includeHistory=true` additionally includes
passports the wallet formerly owned. Historical access is derived from the
initial purchase buyer and signed transfer actors; it never restores owner
actions. Unrelated wallets receive an empty collection and a not-found detail
response, avoiding ownership enumeration.

## Card and detail projection

Cards show the signed product title and image, issuer wallet, audit state,
passport status, ownership relationship, and a warranty countdown calculated at
request time. Newly issued passports animate into the collection while
respecting the operating system's reduced-motion preference.

Detail responses include:

- verified purchase transaction hash, confirmation block, and chain time;
- the immutable signed product version and proof hash;
- current owner and current/former ownership relationship;
- warranty terms and exact start/expiry dates;
- the ordered lifecycle event hashes and actors;
- a public passport URL containing no session or bearer credential; and
- owner actions only when the caller is the current owner and the passport is
  active.

Product copy comes from the signed historical version attached to the passport,
not a mutable current listing. A former owner gets the same evidence as a
read-only historical view but no transfer or warranty action.

## Honest UI states

The collection includes dedicated loading skeleton, empty, retryable network
error, degraded-proof, suspended, expired-warranty, no-warranty, and former-owner
states. A degraded or suspended record stays visible with clear warnings; it is
never silently upgraded to “verified.”
