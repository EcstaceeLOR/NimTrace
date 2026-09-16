# NimTrace privacy disclosure

NimTrace does not create custodial accounts and never receives private keys.
Wallet signatures and NIM payments happen in Nimiq Pay.

## Data used

- **Wallet addresses and public keys:** used for authentication, ownership,
  transfers, and signed lifecycle evidence. Passport and blockchain evidence may
  be public by design.
- **Signatures:** stored with the record they authorize so anyone can verify its
  provenance. Authentication challenges and sessions are not public.
- **Product images and descriptions:** supplied by merchants and published as
  part of product/passport verification. The no-billing deployment uses the
  repository-controlled fallback image instead of R2 uploads.
- **Public-chain data:** transaction hashes, recipient, value, execution state,
  and block/finality evidence are read from Nimiq RPC providers.
- **Device identifier:** not collected by the current release. A future abuse
  control may use one only after explicit disclosure and consent.
- **Analytics:** no third-party analytics are loaded. During judging, only
  manually recorded aggregate funnel counts are used; they exclude full wallet
  addresses, signatures, product descriptions, and transaction details.

## Retention and control

Expired authentication challenges and sessions are operational records and may
be deleted after 30 days. Failed/expired payment intents may be deleted after 90
days. Published products, passports, payments that establish ownership, and
append-only lifecycle events are retained while NimTrace operates because
removing them would break public verification. Public Nimiq transactions remain
subject to the network's own retention. Product-image deletion is available only
before an image is attached to a published signed product.

Questions or deletion requests for non-public operational data should be opened
through the repository owner. NimTrace cannot erase public-chain records or a
valid signed event from an append-only passport history.
