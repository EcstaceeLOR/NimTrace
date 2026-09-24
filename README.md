# NimTrace

**Every product deserves proof that lasts.**

NimTrace is a Nimiq Pay Mini App that turns a NIM purchase into a transferable,
wallet-owned product and warranty passport. It connects a physical product to
its issuer, purchase, current owner, warranty status, repairs, and later resale
without taking custody of user funds or private keys.

NimTrace is not an accounting receipt application. Its unit of value is the
physical product and the lifecycle that follows it:

1. A merchant creates and signs a product record.
2. A buyer pays the merchant directly in NIM.
3. NimTrace independently verifies the tagged transaction on-chain.
4. The product passport is issued to the buyer's Nimiq wallet.
5. Anyone can verify the passport and warranty from its QR code.
6. The owner can transfer the product and its passport to another wallet.
7. Authorized repairers can add signed service records.

## Competition promise

> Scan a product and verify its authenticity, purchase-backed ownership,
> warranty, and service history in under ten seconds.

The Cycle II submission is focused on making that promise work reliably inside
Nimiq Pay on real mobile devices.

**Open in Nimiq Pay:** Mini Apps → Custom URL → `https://nimtrace.vercel.app`

**Web preview:** https://nimtrace.vercel.app

**Production API:** https://nimtrace-api.nimtrace.workers.dev/api/health

## Marketplace lifecycle

The public catalogue is backend-authoritative and separates products into three
mutually exclusive states:

- **Available** — no active checkout exists and a buyer can start a purchase.
- **Checkout in progress** — an active buyer-bound purchase intent currently
  reserves the product, so other buyers cannot enter checkout.
- **Completed** — payment reached finality, the ownership passport was issued,
  and the product is no longer purchasable.

If an unpaid checkout expires or safely fails, the reservation is released and
the product returns to **Available**. The API derives this state from D1 purchase
intent and product lifecycle data; the frontend only renders the state returned
by the backend.

## Payment finality flow

NimTrace does not treat a wallet approval alone as a completed purchase. The
checkout UI tracks the payment through real verification stages:

1. **Checkout created** — amount, seller, product, and unique payment tag are
   locked in a buyer-bound intent.
2. **Transaction detected** — NimTrace has found the on-chain transaction.
3. **Included on Nimiq network** — the transaction has entered a block.
4. **Network finality** — confirmation progress is shown until the configured
   finality threshold is reached.
5. **Ownership proof issued** — the buyer receives the product passport and can
   open its public proof or wallet-owned passport view.

Interrupted or delayed wallet flows are reconciled automatically while the page
is open, and the user is explicitly warned not to submit a second payment while
an existing tagged transaction is being checked.

## Why Nimiq is load-bearing

- Nimiq Pay provides wallet access and native approval dialogs.
- `sendBasicTransactionWithData()` binds a purchase or resale intent to a NIM
  transaction.
- Nimiq RPC data proves recipient, amount, transaction reference, and execution.
- Wallet signatures authenticate issuers, owners, recipients, and repairers.
- Nimiq wallet addresses provide portable identity without a separate account.
- NimTrace never holds funds, signs for users, or accesses private keys.

Remove Nimiq from the system and the core ownership claim stops working.

## Product images and mobile use

Product images are processed client-side before upload, stored in Cloudflare R2,
and content-hashed into the signed product record. Camera capture and device-file
selection are separate flows so Android Nimiq Pay users can choose an existing
image instead of being forced into the camera.

Public product and passport QR links remain HTTPS URLs that can be verified
without connecting a wallet.

## Documentation

- [System architecture](docs/ARCHITECTURE.md)
- [Functional specification](docs/FUNCTIONAL_SPEC.md)
- [Security and trust model](docs/SECURITY.md)
- [Cycle II delivery plan](docs/DELIVERY_PLAN.md)
- [Local development and Nimiq Pay loading](docs/DEVELOPMENT.md)
- [D1 schema, migrations, and concurrency](docs/DATABASE.md)
- [Nimiq Pay wallet adapter and error outcomes](docs/WALLET_ADAPTER.md)
- [Signed wallet authentication](docs/WALLET_AUTH.md)
- [Canonical proof and signature format](docs/PROOF_FORMAT.md)
- [Merchant product issuance](docs/PRODUCT_ISSUANCE.md)
- [Safe product-image processing and R2 storage](docs/PRODUCT_IMAGES.md)
- [Public product verification, QR, and Nimiq Pay handoff](docs/PUBLIC_PRODUCT.md)
- [Buyer-bound purchase intents and transaction tags](docs/PURCHASE_INTENTS.md)
- [Direct Nimiq Pay checkout and recovery states](docs/NIM_CHECKOUT.md)
- [Independent NIM transaction verification](docs/NIM_VERIFICATION.md)
- [Interrupted-payment reconciliation and cleanup](docs/PAYMENT_RECONCILIATION.md)
- [Atomic payment-backed passport issuance](docs/PASSPORT_ISSUANCE.md)
- [Wallet-owned passport collection and detail projection](docs/PASSPORT_COLLECTION.md)
- [Wallet-free public passport verification and QR](docs/PUBLIC_PASSPORT.md)
- [Recipient-bound gift transfers](docs/GIFT_TRANSFERS.md)
- [Payment-backed resale transfers](docs/RESALE_TRANSFERS.md)
- [Signed repair attestations](docs/REPAIR_ATTESTATIONS.md)
- [Accessibility and performance release pass](docs/ACCESSIBILITY_PERFORMANCE.md)
- [Executable quality gate and device checklist](docs/TESTING.md)
- [Judging demo runbook and privacy-safe measurement](docs/DEMO_RUNBOOK.md)
- [Privacy disclosure](docs/PRIVACY.md)
- [Submission description and direct links](docs/SUBMISSION.md)
- [Final release and monitoring checklist](docs/RELEASE_CHECKLIST.md)

## Local development

```bash
npm ci
npm run dev:api
```

In a second terminal:

```bash
npm run dev:web
```

The web app runs at `http://localhost:5173` and the Worker API at
`http://localhost:8787`. See the development guide for physical-device loading
inside Nimiq Pay and all quality commands.

## Production architecture and deployment

Production is split into two independently deployed surfaces:

- **Frontend:** React/Vite is deployed to Vercel at
  `https://nimtrace.vercel.app`. `vercel.json` rewrites `/api/*` requests to the
  production Cloudflare Worker and serves the SPA for application routes.
- **Backend:** the Hono API runs as the `nimtrace-api` Cloudflare Worker. D1
  stores wallet sessions, signed products, buyer-bound payment intents,
  passports, and lifecycle history. R2 stores product images.

API changes on `main` are deployed through the `Deploy API Worker` GitHub Actions
workflow. The workflow typechecks and tests the API, builds the required web
assets for the Worker bundle, deploys with Wrangler, and verifies the production
`/api/health` version before succeeding. CI requires repository secrets named
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

A manual Worker deployment is also available with:

```bash
npm run deploy:api
```

## Stack

- React, TypeScript, and Vite
- `@nimiq/mini-app-sdk`
- Vercel
- Cloudflare Workers
- Hono API
- Cloudflare D1 and R2
- Zod validation
- Vitest and Playwright
- GitHub Actions

## Quality gate

The main CI pipeline covers linting, TypeScript checks, local D1 migrations,
workspace unit tests, production builds, and Playwright judge-critical E2E tests.
Backend lifecycle tests specifically prove that active purchase intents move a
product out of **Available** and into **Checkout in progress**, and that completed
or expired flows transition correctly.

## Limitations

NimTrace proves signed digital history and NIM payment evidence. It does not
physically inspect products, guarantee merchant claims, provide escrow,
insurance, refunds, or legal ownership adjudication. Production acceptance still
requires the real-device/two-wallet checklist documented in the release gate.

## License

MIT. See [LICENSE](LICENSE).
