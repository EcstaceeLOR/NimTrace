# Canonical proof format

NimTrace uses one versioned proof format for product versions, transfers,
warranty actions, and repairs. The format makes the signed meaning stable
across browsers, servers, object field order, and Unicode content.

## Canonical payload

Business data is wrapped as `{ "data": payload, "version": 1 }` before hashing.
Objects are serialized with keys in UTF-16 lexical order, arrays retain their
order, strings use JSON escaping, and numbers use JSON's finite-number format.
Unsupported or lossy values such as `undefined`, `NaN`, class instances, and
cycles are rejected. The UTF-8 canonical string is hashed with SHA-256 and
encoded as lowercase hexadecimal.

## Signed envelope

Every signature covers a strict envelope with these fields:

```json
{
  "action": "OFFER_TRANSFER",
  "app": "nimtrace",
  "expiresAt": "2026-09-14T12:05:00.000Z",
  "issuedAt": "2026-09-14T12:00:00.000Z",
  "network": "main-albatross",
  "nonce": "single-use-nonce-123456",
  "payloadHash": "<64 lowercase hex characters>",
  "previousEventHash": "<64 lowercase hex characters or null>",
  "summary": "Offer Genesis Edition to the selected wallet for 1 NIM.",
  "version": 1
}
```

`previousEventHash` is always present. It is `null` when there is no preceding
lifecycle event and is otherwise checked against the current passport head.
This prevents a valid signature from being moved onto a different history.

The wallet message starts with the human-readable summary and the statement
that signing does not send NIM. The canonical envelope follows in full, so both
the readable meaning and exact machine-verifiable fields are signed.

## Server verification

The server rejects malformed envelopes, wrong actions, networks or nonces,
unexpected previous-event hashes, future or expired timestamps, altered
payloads, and invalid signatures. It derives the Nimiq address from the returned
public key and compares the normalized result with the expected actor address.

Tests include fixed Unicode hashing, reordered fields, cross-network replay,
expiry, payload tampering, hash-chain mismatch, wrong public keys, and wrong
derived addresses.
