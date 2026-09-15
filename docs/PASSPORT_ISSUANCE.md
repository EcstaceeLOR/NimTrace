# Payment-backed passport issuance

A passport is created only from a confirmed, server-bound initial purchase.
NimTrace never accepts owner, product, warranty, or payment values from the
completion request.

## Atomic settlement

When independent verification reaches finality, one D1 `batch()` transaction:

1. conditionally moves the exact submitted hash to `confirmed` with its block
   height and chain timestamp;
2. inserts one passport for the intent's buyer and signed product version;
3. inserts its first append-only `issued` event; and
4. activates the passport and marks that unique physical product `sold` through
   database triggers.

D1 documents batched statements as SQL transactions: a failed statement aborts
and rolls back the entire sequence. Consequently, a missing or invalid event
cannot leave behind a confirmed payment row, partial passport, or sold product.

The schema adds independent enforcement. Passport insertion requires a
confirmed initial-purchase intent whose buyer, product, version, confirmation
time, and calculated warranty match. The first event must reference that same
payment and reuse the issuer public key and signature from the immutable signed
product version.

## Warranty and ownership

`warranty_started_at` is the verified transaction's chain timestamp, not the
time a Worker happens to process it. Expiry is that timestamp plus the signed
product's integer warranty duration. The initial owner is always the intent's
authenticated buyer wallet.

## Idempotency and single sale

Both `passports.product_id` and `passports.purchase_intent_id` are unique, as is
the issued event's payment reference. Concurrent completion attempts may
prepare different random IDs, but only one batch can win; losing/replayed calls
read and return the winner.

The authenticated replay endpoint is:

```http
POST /api/payment-intents/<intent-id>/completion
Authorization: Bearer <original-buyer-session>
```

It returns the existing active passport after verifying its first audit event.
Another wallet receives a not-found response, and an unconfirmed intent returns
a conflict without creating ownership.

## First-event audit hash

The canonical issued payload includes:

- passport ID and buyer owner address;
- payment intent, transaction hash, confirmed block, and chain time;
- signed product ID, version, and payload hash; and
- warranty start and expiry.

Its SHA-256 payload hash feeds a second canonical event-header hash containing
the passport ID, sequence `1`, type `issued`, and `previousEventHash: null`.
Before returning a passport, the audit projection reparses and canonicalizes the
payload, recomputes both hashes, checks the event/head link, and compares every
payload reference with current immutable database evidence.

The resulting owner and historical views are described in
[PASSPORT_COLLECTION.md](./PASSPORT_COLLECTION.md).
