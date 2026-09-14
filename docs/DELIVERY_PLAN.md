# Cycle II Delivery Plan

## Deadline

The submission deadline is September 18, 2026 at 23:59 UTC. The implementation
order optimizes for a complete, reliable vertical slice before differentiators.

## Release strategy

The competition release is built in three gates:

1. **Proof gate** — wallet signature and tagged NIM transaction can be verified.
2. **Product gate** — product purchase creates a public, wallet-owned passport.
3. **Differentiation gate** — ownership transfers and warranty lifecycle work
   across two real wallets.

No P1 feature may destabilize a completed P0 journey.

## Day 1 — foundation and proof gate

- Scaffold React/Vite web app and Cloudflare Worker/D1.
- Add shared schemas, integer Luna utilities, and environment validation.
- Implement wallet adapter and normalized error handling.
- Implement signed challenge authentication.
- Prove `sendBasicTransactionWithData()` on testnet.
- Verify a real transaction through RPC using a server-created intent.
- Deploy preview and production shells immediately.

Exit condition: one real phone can authenticate, send tagged testnet NIM, and
receive server-confirmed evidence without secrets in the client.

## Day 2 — product and passport gate

- Create D1 migrations and repositories.
- Build merchant product form and signed immutable product version.
- Build public product/checkout route and QR code.
- Complete payment state machine and reconciliation.
- Atomically issue passport after payment.
- Build owner passport collection and public verification projection.

Exit condition: merchant creates headphones, buyer pays, and a logged-out browser
verifies purchase-backed ownership and warranty.

## Day 3 — differentiation and polish

- Implement recipient-bound gift transfer across two wallets.
- Add paid resale only after gift transfer is stable.
- Implement warranty countdown and presentation view.
- Add co-signed repair record only after transfer is stable.
- Add animations, empty states, skeletons, retry states, reduced motion, and
  accessibility pass.
- Test background/resume and wallet cancellation on real devices.

Exit condition: the passport follows the product to a second wallet and the
entire lifecycle is understandable without narration.

## Day 4 — release, usage, and story

- Freeze schema and risky feature work.
- Run unit, integration, end-to-end, mobile, and production smoke tests.
- Seed a polished merchant catalogue with legitimate demonstration products.
- Record a 60–90 second two-phone demo.
- Submit before the deadline and confirm public listing/deep link.
- Publish Skool and social launch posts.
- Recruit at least 25 legitimate wallet users and capture actionable feedback.
- Monitor uptime, RPC failures, and payment-intent outcomes through judging.

## Scope cut order

If schedule slips, cut in this order:

1. Additional languages
2. Printable label designer
3. Repair attachments
4. Repair workflow
5. Paid resale

Do not cut:

- independent payment verification;
- public passport verification;
- recipient-bound ownership transfer;
- honest error and trust states;
- real-device testing.

Without ownership transfer, NimTrace risks reading as a receipt application.

## Demonstration script

1. Merchant signs a passport for headphones.
2. Buyer scans the physical QR label.
3. Buyer reviews issuer, warranty, and 1 NIM price.
4. Nimiq Pay shows and approves the native payment.
5. NimTrace confirms the transaction and reveals the passport.
6. A third browser scans the passport and sees verified provenance.
7. Owner offers the headphones to a specified second wallet.
8. Recipient accepts; optional resale payment is approved.
9. Passport timeline updates and the new wallet becomes owner.

The narration should emphasize: direct payment, no custody, issuer signature,
independent verification, transferable ownership, and explicit limitations.

## Go/no-go checks

### End of Day 1

If real-device signing and tagged payment verification do not work, stop feature
development and fix the integration.

### Mid-Day 2

If the payment cannot reliably issue exactly one passport, remove uploads and
use a fixed demo product until the lifecycle is stable.

### End of Day 3

If paid resale is unstable, ship reliable gift transfer. Do not claim escrow or
atomic exchange.

### Submission day

If any feature can cause duplicate payment or incorrect ownership, hide it
behind a disabled “coming after Cycle II” state rather than shipping unsafe code.
