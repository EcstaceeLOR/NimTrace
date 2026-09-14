# Merchant product issuance

Product issuance is an authenticated, merchant-signed operation. NimTrace does
not claim that a merchant is legally verified; the signature proves only that
the controlling wallet approved the product statement.

## Workflow

1. The merchant enters a title, serial/reference, image, exact NIM price,
   warranty duration, warranty summary, and optional description.
2. The client converts the decimal NIM string to integer Luna with string and
   `BigInt` arithmetic. Exponents, negatives, zero, excess decimals, and unsafe
   values are rejected.
3. The API assigns the product ID and a five-minute, single-use proof nonce. It
   hashes the normalized serial/reference rather than publishing the raw value.
4. The merchant reviews the readable action and signs the canonical version-1
   product payload in Nimiq Pay.
5. The server validates the active wallet session, payload, nonce, network,
   expiry, public key, signature, and public-key-derived issuer address.
6. A single D1 batch creates the merchant (when new), product, and immutable
   signed version. A trigger consumes the proof nonce in the same transaction.

The UI exposes draft, image-processing/upload progress, review, signing,
published, and failed states and collapses to one column on small screens.
Safe image processing stores the final content hash in the signed payload and
uses a fixed demo fallback when R2 is unavailable.

## Version guarantees

`product_versions` is append-only. Database triggers reject updates and
deletes, require monotonically sequential version numbers, and advance the
product's current-version pointer exactly once. A changed signed statement is
therefore represented by a new version while every older proof remains intact.
