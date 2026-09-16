# NimTrace Mini App listing packet

## Canonical links

- Pre-listing Nimiq Pay entry: Mini Apps → Custom URL → `https://nimtrace.vercel.app`
- Web URL: `https://nimtrace.vercel.app`
- Source: `https://github.com/EcstaceeLOR/NimTrace`
- Privacy: `https://github.com/EcstaceeLOR/NimTrace/blob/main/docs/PRIVACY.md`
- Support: `https://github.com/EcstaceeLOR/NimTrace/issues`

## Listing copy

**Name:** NimTrace

**Tagline:** Product ownership, proven.

**Description:** NimTrace turns a direct NIM purchase into a wallet-owned product passport. Issuers sign product records, buyers pay issuers directly in NIM, NimTrace independently verifies the tagged transaction, and owners can later verify warranty, show signed repair history, transfer the passport, or manage live listings from the merchant command center.

**Category:** Commerce / Product authenticity

**Nimiq use:** Nimiq Pay account access and signatures authenticate issuers and owners; tagged NIM payments prove purchases without custody; independent Nimiq RPC verification gates passport issuance.

## Assets

- App icon: `apps/web/public/nimtrace-logo-v1.png`
- Open Graph metadata and web manifest are published with the web app.
- QR verification supports a user-triggered camera photo, image upload, and typed Passport ID fallback.
- The production API health endpoint reports the configured Nimiq network before any wallet action.

## Submission requirement

The owner must submit the canonical web URL in the Mini Apps directory or official competition flow and approve the Nimiq Pay wallet request. NimTrace never receives that wallet's private key and cannot perform the approval on its behalf.

## Owner-only final gate

- [ ] Open the canonical URL in Nimiq Pay through **Mini Apps → Custom URL**.
- [ ] Complete the two-wallet testnet walkthrough in `docs/DEMO_RUNBOOK.md`.
- [ ] Confirm camera photo, QR upload, and typed Passport ID verification on the target phone.
- [ ] Submit the listing and complete the Nimiq Pay owner approval request.
- [ ] Record the resulting listing URL here and in `docs/SUBMISSION.md`.
