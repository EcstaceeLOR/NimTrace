# NimTrace judging runbook

## Catalogue

Use the fixed signed demo product when R2 is unavailable. It is intentionally
an honest, repeatable “Genesis Edition” product with a 1 NIM price, explicit
warranty language, and a repository-controlled image fallback. Do not invent
payment confirmations or ownership events. For a live merchant catalogue, issue
additional products from the issuer flow and record their real product IDs.

## 75-second story

1. Merchant opens NimTrace in Nimiq Pay and signs the Genesis Edition passport.
2. Buyer scans the product QR, reviews the recipient, exact 1 NIM amount, and
   warranty, then approves the native Nimiq Pay payment.
3. NimTrace independently verifies the tagged transaction and issues the
   buyer-bound passport.
4. A second phone opens the public QR and sees the signed provenance timeline.
5. The owner creates a recipient-bound transfer; the recipient accepts it and
   the public page shows the new owner state.
6. If demonstrating service history, use a repairer wallet to sign the repair
   record and let the owner acknowledge it. Explain that this is a signer
   attestation, not a physical inspection by NimTrace.

## Privacy-safe measurement

Until consented analytics are deployed, record only aggregate counts in the
judge log: public opens, wallet connects, submitted payments, issued passports,
verified passports, and completed transfers. Never export full wallet
addresses, signatures, descriptions, device identifiers, or transaction data.
Do not use bots or repeated opens to inflate the funnel.

## External completion checklist

- Run the two-phone background/resume and cancellation checklist in
  `docs/TESTING.md`.
- Publish the prepared launch copy in the Skool and public social channels.
- Recruit at least 25 unique, consenting wallet users and collect feedback from
  at least 10 of them.
- Capture the production URL, repository URL, and 60–90 second recording link
  for the submission package.
