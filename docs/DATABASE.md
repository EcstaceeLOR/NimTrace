# NimTrace database

NimTrace stores lifecycle state in Cloudflare D1. The schema uses SQLite `STRICT`
tables, foreign keys, status checks, unique payment and event identifiers, and
append-only triggers for signed product versions and passport events.

## Tables

- `wallet_challenges` and `wallet_sessions` persist only hashes and lifecycle state.
- `merchants`, `products`, and `product_versions` establish immutable issuer proof.
- `payment_intents` binds product, wallets, amount, transaction tag, and chain hash.
- `passports` holds the owner, warranty, event head, and concurrency version.
- `passport_events` is an append-only, strictly ordered hash chain.
- `transfer_intents` coordinates signed gifts and payment-backed resale.
- `repair_attestations` holds repairer proof and owner acknowledgement.

## Apply migrations

From the repository root, apply migrations to the normal local database:

```bash
npm run db:migrate:local
```

Wrangler records applied files in `d1_migrations`, so the command is idempotent.

## Authenticated preview database

Wrangler requires authentication for preview D1 operations and rejects combining
`--preview` with `--local`. Long-lived database IDs are intentionally not committed.
After creating separate D1 databases, replace the documented placeholder IDs in
`apps/api/wrangler.jsonc` and apply only to the preview binding:

```bash
npm run db:migrate:preview
```

That command uses Wrangler's `--preview --remote` flags. Never point the preview ID
at production. Back up D1 before applying any future destructive migration.

## Concurrency and atomicity

Passport writes include the version observed by the caller and increment it once.
Zero changed rows means another workflow won the race. Passport-event insertion
checks the next sequence and previous hash, then advances the passport head and
version through a trigger. Multi-statement application workflows must use D1
`batch()` so a failed statement rolls back the atomic batch.
