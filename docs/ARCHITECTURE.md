# NimTrace System Architecture

## 1. Architectural objective

NimTrace creates a verifiable chain of evidence around a physical product:

```text
merchant-signed product
        -> buyer-bound payment intent
        -> verified NIM transaction
        -> wallet-owned passport
        -> warranty / repair events
        -> recipient-bound transfer
        -> optional verified resale payment
```

The blockchain proves money movement. Wallet signatures prove that a specific
wallet approved a product, attestation, or ownership transition. NimTrace's
database indexes that evidence, applies lifecycle rules, and makes the result
fast enough to use as a consumer product.

NimTrace does not claim that a blockchain can inspect a physical object. The
application proves who made each digital claim, whether a referenced payment
occurred, and whether the recorded ownership transitions form a valid chain.

## 2. Design principles

1. **Nimiq is load-bearing.** Purchase and ownership claims depend on NIM
   transactions and Nimiq wallet signatures.
2. **No custody.** Payments move directly from buyer to seller. NimTrace has no
   treasury wallet and never handles private keys.
3. **One obvious primary flow.** A first-time user can create, buy, or verify a
   product without instructions.
4. **Server verifies; client never declares success.** All material payment and
   signature claims are independently checked.
5. **Append-only history.** Confirmed lifecycle events are never silently
   rewritten. Corrections are new signed events.
6. **Privacy by minimization.** Wallet addresses are the default identifiers;
   names, email addresses, and shipping details are not required.
7. **Mobile first.** Every primary flow is designed for the Nimiq Pay WebView
   and tested on a physical phone.
8. **Honest assurance.** The UI distinguishes cryptographic verification from
   merchant assertions and physical inspection.

## 3. System context

```text
                              Public browser
                                    |
                                    | read-only passport verification
                                    v
+----------------+          +----------------------+          +----------------+
|   Nimiq Pay    |<-------->|  NimTrace Web App   |<-------->| NimTrace API   |
|                | provider |  React / Vite       |  HTTPS   | Worker / Hono  |
| - NIM wallet   | requests |                    |          |                |
| - approvals    |          +----------------------+          +-------+--------+
| - signatures   |                                                     |
+-------+--------+                                                     |
        |                                                  +----------+----------+
        | NIM transactions                                |                     |
        v                                                  v                     v
+----------------+                                 +---------------+      +-------------+
| Nimiq network  |<---------- JSON-RPC -----------| D1 database   |      | R2 images   |
| / RPC indexer  |                                 | state + index |      | public media|
+----------------+                                 +---------------+      +-------------+
```

### Trust boundary

- Nimiq Pay is trusted to protect keys and present native approval dialogs.
- The Nimiq network is the source of truth for payments.
- Wallet signatures are the source of truth for actor authorization.
- The API is trusted to enforce ordering and availability, but it cannot forge
  wallet signatures or create NIM payments.
- Merchants are responsible for the truth of physical-product claims they sign.
- Repairers are responsible for the service claims they sign.

## 4. Runtime components

### 4.1 Web application

Responsibilities:

- Detect whether it runs inside Nimiq Pay.
- Connect to the Nimiq provider only when a wallet action is needed.
- Render public product and passport pages without requiring wallet access.
- Request wallet signatures and NIM transactions through native dialogs.
- Submit evidence to the API; never mark it verified locally.
- Provide recoverable states for rejection, timeout, lost connectivity, and an
  approved payment whose confirmation has not yet appeared.

Feature modules:

```text
src/
  app/                   routing, providers, error boundary, telemetry
  features/
    wallet/              provider discovery, connect, sign, session
    issuer/              merchant profile and product issuance
    checkout/            purchase intents and NIM payment state machine
    passports/           owner collection and passport detail
    verification/        public QR verification experience
    transfers/           gift and paid resale lifecycle
    warranty/            warranty status and claims
    repairs/             repairer attestations
  components/            shared accessible UI primitives
  lib/
    api/                 typed API client
    nimiq/               Mini App SDK adapter and error normalization
    canonical/           deterministic payload construction and hashing
    formatting/          NIM/Luna, addresses, dates, localization
  styles/                tokens, layout, motion, reduced-motion variants
```

### 4.2 Wallet adapter

All provider calls live behind one interface. This prevents feature code from
mixing wallet behavior with business logic and makes rejection/error behavior
consistent.

```ts
interface NimTraceWallet {
  connect(): Promise<{ address: string }>
  sign(payload: string): Promise<WalletSignature>
  pay(input: {
    recipient: string
    valueLuna: number
    data: string
  }): Promise<{ transactionHash: string }>
  deviceId(reason: string): Promise<string | null>
}
```

The adapter normalizes at least these outcomes:

- user cancelled;
- provider missing / opened outside Nimiq Pay;
- consensus unavailable;
- invalid transaction;
- request timed out;
- RPC confirmation delayed;
- application resumed after a native approval dialog.

### 4.3 API worker

Responsibilities:

- Issue single-use wallet-authentication challenges.
- Verify Nimiq signatures and bind them to wallet addresses.
- Create immutable product versions and lifecycle events.
- Create purchase and transfer payment intents.
- Independently verify NIM transactions against stored intent values.
- Serialize ownership changes inside database transactions.
- Produce a public verification projection for fast QR scans.
- Enforce idempotency, expiry, uniqueness, validation, and rate limits.
- Store only hashes and public evidence required for verification.

Suggested server modules:

```text
worker/
  routes/                HTTP route definitions
  middleware/            auth, CORS, rate limits, request IDs
  services/
    auth-service.ts
    product-service.ts
    purchase-service.ts
    passport-service.ts
    transfer-service.ts
    warranty-service.ts
    repair-service.ts
    verification-service.ts
    transaction-verifier.ts
    signature-verifier.ts
  repositories/          D1 queries; no business decisions
  jobs/                  pending-payment reconciliation and cleanup
  security/              canonicalization, hashing, token handling
shared/
  domain.ts
  schemas.ts
  api-contract.ts
  constants.ts
```

### 4.4 Nimiq transaction verifier

The client first asks the server to create an intent. The intent stores the
expected values before Nimiq Pay is asked to move funds.

For every payment, the verifier checks:

- transaction exists and executed on the expected network;
- transaction hash has not been used before;
- recipient equals the intent seller;
- amount equals the integer Luna amount stored in the intent;
- transaction data contains the exact compact intent reference;
- at least 60 confirmations carry the transaction beyond the next Albatross
  macro-block finality point;
- intent has not expired or already settled;
- authenticated buyer is related to the transaction where the RPC exposes the
  originating wallet through `relatedAddresses` or equivalent HTLC context.

The transaction hash returned by Nimiq Pay is submitted immediately, but a
reconciliation job can recover an interrupted flow using the unique intent tag.

### 4.5 Signature verifier

Signed messages use versioned, deterministic payloads. A signature is accepted
only when the public key derives to the claimed Nimiq address.

Example logical envelope:

```json
{
  "app": "nimtrace",
  "version": 1,
  "action": "ISSUE_PRODUCT",
  "network": "main-albatross",
  "nonce": "single-use-server-nonce",
  "issuedAt": "2026-09-14T12:00:00Z",
  "expiresAt": "2026-09-14T12:05:00Z",
  "payloadHash": "sha256-of-canonical-product-payload"
}
```

The exact serialized message shown in Nimiq Pay must be understandable. The
server stores the signed message, public key, signature, derived address, and
verification result.

### 4.6 Storage

**D1** stores relational state and the append-only event ledger. **R2** stores
sanitized product images. Product images are presentation data and never part
of the sole proof; the signed product version contains their content hash.

No private key, seed phrase, raw session token, precise location, email, or
shipping address is stored.

## 5. Domain model

### Merchant

- `wallet_address` — primary identity
- `display_name` — optional public label
- `profile_slug` — public route
- `created_at`
- `status`

### Product

Represents one physical item, not a reusable catalogue SKU.

- `id`
- `issuer_address`
- `title`
- `serial_number_hash` — raw serial is optional/private
- `description`
- `image_key` and `image_hash`
- `warranty_duration_days`
- `current_version`
- `status` — draft, offered, sold, suspended

### ProductVersion

- `product_id`
- `version`
- `canonical_payload`
- `payload_hash`
- `issuer_public_key`
- `issuer_signature`
- `created_at`

Once signed, a version is immutable. Editing creates the next version. Existing
owners can see exactly which version applied when they purchased.

### PaymentIntent

- `id`
- `purpose` — initial purchase or resale
- `product_id`
- `seller_address`
- `buyer_address`
- `amount_luna`
- `transaction_data`
- `expires_at`
- `status` — pending, submitted, confirmed, expired, failed
- `transaction_hash` — unique when present
- `confirmed_block_height`

### Passport

- `id`
- `product_id`
- `current_owner_address`
- `purchase_intent_id`
- `warranty_started_at`
- `warranty_expires_at`
- `head_event_hash`
- `status` — active, transfer_pending, suspended
- `version`

### PassportEvent

An append-only chain:

- `id`
- `passport_id`
- `sequence`
- `type` — issued, transferred, repaired, warranty_claimed, corrected
- `previous_event_hash`
- `canonical_payload`
- `payload_hash`
- `actor_address`
- `actor_public_key`
- `actor_signature`
- `payment_intent_id` — nullable
- `created_at`

The event hash includes the previous hash, creating a tamper-evident ordered
history in addition to normal database constraints.

### TransferIntent

- `id`
- `passport_id`
- `from_address`
- `to_address`
- `price_luna` — zero for a gift
- `expires_at`
- `owner_offer_signature`
- `recipient_acceptance_signature`
- `payment_intent_id` — required when price is non-zero
- `status`

### RepairAttestation

- `id`
- `passport_id`
- `repairer_address`
- `service_type`
- `notes`
- `serviced_at`
- `evidence_hash` — optional
- `signature`

## 6. Core workflows

### 6.1 Wallet authentication

```text
connect wallet
  -> API creates single-use challenge
  -> Nimiq Pay signs readable challenge
  -> API verifies signature and derived address
  -> API returns opaque session token
  -> only the hash of that token is stored server-side
```

Authentication proves wallet control; it does not prove a legal identity.

### 6.2 Product issuance

```text
merchant enters product data
  -> API validates and uploads sanitized image
  -> client builds canonical product payload
  -> merchant signs ISSUE_PRODUCT payload
  -> API verifies signature/address
  -> immutable ProductVersion is created
  -> public product QR becomes available
```

### 6.3 Initial purchase and passport issuance

```text
buyer opens QR/product link
  -> reads product before connecting wallet
  -> connects and authenticates wallet
  -> API creates buyer-bound purchase intent
  -> client displays seller, exact price, warranty, and product
  -> Nimiq Pay sends tagged NIM payment directly to seller
  -> client submits transaction hash
  -> API independently verifies transaction
  -> database transaction marks intent confirmed
  -> passport + ISSUED event are created for buyer wallet
  -> buyer sees confirmation and shareable passport QR
```

The endpoint is idempotent. Replaying the same transaction returns the original
passport rather than issuing a second one.

### 6.4 Public verification

```text
scan QR
  -> load read-only verification projection
  -> verify issuer signature and product hash
  -> show verified purchase transaction
  -> show masked current owner and event chain
  -> show warranty state and signed repairs
```

Verification states are explicit:

- **Verified** — signatures, chain references, and event order are valid.
- **Partially verified** — cryptographic evidence is valid but chain lookup is
  temporarily unavailable.
- **Unverified** — evidence is missing or invalid.
- **Merchant claim** — descriptive claim signed by merchant but not independently
  physically inspected by NimTrace.

### 6.5 Gift transfer

```text
owner enters recipient wallet
  -> API creates recipient-bound transfer intent
  -> owner signs transfer offer
  -> recipient opens link and signs acceptance
  -> API locks passport row and verifies both signatures
  -> TRANSFERRED event is appended
  -> current owner changes atomically
```

### 6.6 Paid resale

Paid resale adds a direct NIM transaction between acceptance and finalization:

```text
owner signs recipient-bound offer with exact price
  -> recipient signs acceptance
  -> API creates payment intent
  -> recipient pays owner in NIM
  -> API verifies payment
  -> ownership changes atomically
```

NimTrace is not an escrow. The UI must say that the payment goes directly to
the current owner and that NimTrace cannot reverse it.

### 6.7 Repair event

The current owner invites a repairer wallet to a passport. The repairer signs a
service record; the owner acknowledges it. Only then is a REPAIRED event added.
NimTrace proves who signed the statement, not that the repair was physically
performed.

## 7. API surface

```text
POST   /v1/auth/challenges
POST   /v1/auth/sessions
DELETE /v1/auth/sessions/current

POST   /v1/products
POST   /v1/products/:id/versions
GET    /v1/products/:id
POST   /v1/products/:id/purchase-intents

POST   /v1/payment-intents/:id/submit
GET    /v1/payment-intents/:id

GET    /v1/passports
GET    /v1/passports/:id
GET    /v1/passports/:id/verify

POST   /v1/passports/:id/transfer-intents
POST   /v1/transfer-intents/:id/offer
POST   /v1/transfer-intents/:id/accept
POST   /v1/transfer-intents/:id/payment

POST   /v1/passports/:id/repair-invitations
POST   /v1/repair-invitations/:id/attest
POST   /v1/repair-attestations/:id/acknowledge
```

Every mutating endpoint accepts an idempotency key. Error responses use stable
machine codes plus clear user-facing guidance.

## 8. State machines

### Purchase

```text
PENDING -> PAYMENT_SUBMITTED -> CONFIRMED -> PASSPORT_ISSUED
   |              |                |
   +-> EXPIRED    +-> PENDING      +-> RECONCILIATION_REQUIRED
                  +-> FAILED
```

User cancellation returns to `PENDING`; it is not displayed as an application
error. A submitted payment is never casually retried until its hash or intent
tag has been reconciled, preventing accidental double payment.

### Transfer

```text
DRAFT -> OWNER_SIGNED -> RECIPIENT_ACCEPTED -> PAYMENT_PENDING -> COMPLETED
  |          |                  |                   |
  +----------+------------------+-------------------+-> EXPIRED/CANCELLED
```

`PAYMENT_PENDING` is skipped for gifts. Only `COMPLETED` changes ownership.

## 9. Deployment topology

```text
Production
  app.nimtrace.example       Cloudflare Pages
  api.nimtrace.example       Cloudflare Worker
  D1 production database     automated daily export
  R2 product media           immutable hashed object keys

Preview
  pull-request Pages URLs    isolated preview API/database

Development
  Vite --host                loaded through Nimiq Pay Custom URL
  Wrangler dev               local Worker + D1
  Nimiq testnet              test transactions
```

Production and testnet records must never share a database. Every signed payload
contains its network to prevent cross-network replay.

## 10. Observability and reliability

- Structured logs with request ID, route, result, duration, and safe identifiers.
- No signatures, session tokens, full wallet addresses, or product descriptions
  in logs.
- Health endpoint checks Worker, D1, and current RPC block height.
- Client error boundary offers reload and support details instead of a blank page.
- Payment-intent metrics cover created, cancelled, submitted, confirmed, failed,
  expired, and reconciled.
- Synthetic verification-page check runs periodically during judging.
- RPC requests use timeout, bounded retry, and a second configured provider for
  read-only verification.

## 11. Testing strategy

### Unit

- canonical payload stability;
- signature verification and address derivation;
- Luna integer handling;
- warranty date calculations;
- purchase and transfer state machines;
- event hash-chain validation;
- error normalization.

### Integration

- D1 uniqueness and transaction behavior;
- transaction verification with real testnet fixtures;
- duplicate transaction rejection;
- expired/replayed challenge rejection;
- interrupted-payment reconciliation;
- concurrent ownership transfer rejection.

### End to end

- merchant issues product;
- buyer rejects then successfully approves payment;
- passport appears only after verification;
- public QR route works without wallet access;
- gift transfer completes across two wallets;
- paid resale completes and changes owner once;
- repairer and owner co-sign a repair;
- app resumes correctly after backgrounding/native confirmation.

### Physical-device release gate

No release is considered ready until the primary journey succeeds inside Nimiq
Pay on a physical phone over the production HTTPS deployment.

## 12. Architectural decisions intentionally deferred

- NFT minting or EVM contracts
- escrow, refunds, or dispute arbitration
- regulatory Digital Product Passport compliance claims
- decentralized file storage
- manufacturer identity verification or KYC
- bulk inventory and enterprise ERP integrations
- cross-chain payments and USDT checkout
- public resale marketplace

These can be future products. They are not required to prove NimTrace's core
competition promise.
