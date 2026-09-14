# NimTrace Security and Trust Model

## Security goals

- NimTrace cannot move user funds.
- NimTrace cannot sign product or transfer claims for a wallet.
- A fabricated client response cannot create ownership.
- A transaction cannot be reused for a second purchase or transfer.
- A stale owner cannot transfer a passport after ownership has changed.
- Public verification remains honest when an external dependency is unavailable.
- Personal data collection is minimized and disclosed.

## Explicit non-guarantees

Cryptography cannot establish that a physical item matches its description.
NimTrace proves that an issuer wallet signed a description, a NIM payment
occurred, and wallet holders authorized the recorded lifecycle. Issuer identity,
physical authenticity, repair quality, legal warranty rights, delivery, and
refund entitlement require separate real-world processes.

## Threats and controls

| Threat | Primary controls |
|---|---|
| Client claims payment without paying | Server-created intent and independent RPC verification |
| Transaction replay | Unique transaction-hash constraint and settled-intent state |
| Signature replay | Action, network, nonce, expiry, payload hash, and previous event hash inside signed envelope |
| Product edited after sale | Immutable signed product versions |
| Old owner attempts transfer | Row lock/version check and current-owner verification |
| Double transfer race | Recipient-bound offer, passport version, database transaction, one completed intent |
| Wrong recipient/amount | Exact server-stored recipient and integer Luna comparison |
| User double pays after interruption | Intent reconciliation before retry and disabled outstanding action |
| Fake repair history | Repairer signature plus owner acknowledgement |
| API forges lifecycle | Public signatures and hash chain expose unsigned/altered events |
| RPC outage | Bounded retry, secondary read provider, and explicit partially verified state |
| Bot/spam issuance | Wallet rate limits, optional consented device identifier, IP throttling |
| Image abuse | Type/size checks, decode/re-encode, random hashed object name, no active formats |
| Sensitive log leakage | Structured allowlist logging; token/signature/description redaction |

## Wallet authentication

1. API returns a random, single-use nonce with five-minute expiry.
2. Client constructs the exact versioned login message.
3. Nimiq Pay signs it after native user approval.
4. API verifies signature, public key, derived address, nonce, origin, and expiry.
5. API consumes the nonce transactionally and returns a high-entropy session
   token.
6. Database stores only `SHA-256(sessionToken)`.

Authentication messages never request payment approval and say what is being
authorized in plain language.

## Payment safety

- Values are integer Luna end to end; floating point is forbidden in money code.
- Intent values are created and stored before provider invocation.
- Client may submit only transaction hash, not expected recipient or amount.
- Verification checks execution, network, recipient, value, data, uniqueness,
  expiry, and the available wallet relationship evidence.
- Confirmation failures are recoverable and never silently treated as success.
- The UI warns before all direct payments that NimTrace does not provide escrow
  or chargebacks.

## Signature format

- Deterministic canonical JSON serialization
- SHA-256 payload hash encoded in lowercase hexadecimal
- Domain separator: `nimtrace`
- Protocol version
- Explicit action type and network
- Single-use nonce where a server-side action is performed
- Issue and expiry timestamps
- Previous event hash for lifecycle additions
- Human-readable summary prepended to opaque hashes

Signature-verification test vectors must cover Unicode, field ordering, altered
amounts, altered recipients, expired nonces, wrong public keys, and cross-network
replay.

## Privacy

- No legal names, email addresses, phone numbers, or delivery addresses required.
- Owner wallet addresses are masked on public projections by default.
- Full blockchain transactions remain public by the nature of Nimiq and this is
  explained before payment.
- Raw device identifiers are hashed again with a server-side application salt
  and used only for abuse-rate buckets.
- Product serial numbers may be stored as salted hashes with a short public
  fingerprint.
- Optional analytics use explicit consent and exclude full wallet addresses.
- Retention periods are documented before production launch.

## Secret management

- No private key or API credential is committed to the repository.
- Worker secrets are stored through the deployment platform's secret manager.
- Local development uses ignored `.dev.vars` or `.env` files.
- `.env.example` documents names only.
- Automated secret scanning runs in CI.

## Release security gate

- Threat-model review completed
- Dependency audit has no unresolved high/critical finding
- Authentication and signature replay tests pass
- Payment verification tested with real testnet fixtures
- Duplicate payment and concurrent transfer tests pass
- Security headers and strict content policy enabled
- Public pages disclose verification limitations
- No development wallet, seed, token, or synthetic proof in production
