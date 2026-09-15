# Public passport verification

`/passports/:passportId` is a wallet-free verification surface designed for a
product QR label. It does not request a Nimiq Pay connection and the QR contains
only the public route: no session token, bearer credential, query string, or
fragment.

The Worker builds `GET /api/passports/:passportId/verification` from four
independent evidence layers:

1. the issuer-signed historical product version and its canonical payload hash;
2. a fresh read-only Nimiq RPC check of the purchase transaction, including
   network, recipient, amount, intent tag, buyer relationship, execution, block,
   timestamp, and finality;
3. the masked current owner bound by the passport record; and
4. every canonical lifecycle payload, payload hash, previous hash, event hash,
   and the stored chain head, including the full issuance-to-purchase binding.

The public projection never returns a full owner or lifecycle actor address.
Addresses are compacted and masked at the API boundary.

## Honest states

- `verified`: all stored and live evidence passed.
- `partially_verified`: stored evidence passed, but live RPC evidence is pending
  or unavailable. The response includes `checkedAt` and a specific reason.
- `unverified`: a signature, hash chain, purchase field, or other proof failed.
- `merchant_claim`: presentation state for information that has no independent
  cryptographic proof.

Merchant description and warranty wording always live in a visually separate
“Merchant claims” section. Warranty start and expiry dates remain in the facts
section because the issued event binds those dates to the verified purchase.

## Latency and caching

Public verification uses one 750 ms attempt per configured RPC provider. With a
primary and fallback provider, its maximum network wait is 1.5 seconds before it
returns an honest partial result. Successful responses use a short 15-second
public cache window plus 60 seconds of stale-while-revalidate for fast repeat QR
scans without making old data look permanently current.

The test suite covers valid evidence, RPC outage degradation, tampered event
fixtures, all four rendered verdicts, actor masking, credential-free fetching,
and secret-free QR generation.
