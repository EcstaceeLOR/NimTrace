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

The Cycle II submission is deliberately focused on making that promise work
reliably inside Nimiq Pay on a real phone.

## Why Nimiq is load-bearing

- Nimiq Pay provides wallet access and native approval dialogs.
- `sendBasicTransactionWithData()` binds a purchase or resale intent to a NIM
  transaction.
- Nimiq RPC data proves recipient, amount, transaction reference, and execution.
- Wallet signatures authenticate issuers, owners, recipients, and repairers.
- Nimiq wallet addresses provide portable identity without a separate account.
- NimTrace never holds funds, signs for users, or accesses private keys.

Remove Nimiq from the system and the core ownership claim stops working.

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

## Planned stack

- React, TypeScript, and Vite
- `@nimiq/mini-app-sdk`
- Cloudflare Pages and Workers
- Hono API
- Cloudflare D1 and R2
- Zod validation
- Vitest and Playwright

## Repository status

Architecture and delivery planning are complete. The React mini app, Worker API,
shared contracts, automated checks, and CI foundation are implemented.
Feature work is tracked in GitHub Issues under the **Cycle II Submission** milestone.

## License

MIT. See [LICENSE](LICENSE).
