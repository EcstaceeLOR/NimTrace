# NimTrace quality gate

The merge gate runs lint, TypeScript checks, local D1 migrations, unit and
integration tests, and production builds. Current coverage includes:

- canonical payloads, signatures, event hashes, replay and expiry checks;
- Luna/NIM amount conversion and payment verification fixtures, including a
  testnet HTLC payout fixture;
- product issuance, warranties, public verification, transfer acceptance,
  resale payment, and QR presentation flows;
- web checkout, wallet cancellation, responsive public pages, image fallback,
  and Mini App locale fallback.

## Device/E2E checklist

Before a judging release, run the production URL in two physical Nimiq Pay
phones (buyer/owner and recipient/repairer): issue → pay → background/resume →
publicly verify → create transfer → accept transfer → verify the new owner.
Repeat with wallet cancellation, delayed confirmation, an expired link, a
wrong recipient, duplicate taps, and offline/retry. A pass requires no false
success state and no lost passport history.

The checklist deliberately remains separate from CI because it requires real
wallet signing and network conditions; CI blocks all deterministic P0 tests.
