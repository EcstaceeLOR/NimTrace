# Interrupted-payment reconciliation

NimTrace treats every interrupted checkout as a recovery problem, never as a
reason to start another wallet payment. A unique `NTP1:<intent-id>` recipient
data tag links the server-created intent to its on-chain transaction even when
the browser closes before Nimiq Pay returns a hash.

## Recovery paths

- A captured hash is submitted idempotently. Repeating the same hash returns
  the existing state; a different hash is rejected.
- An intent with no captured hash is searched through the merchant's recent
  transaction history with the read-only `getTransactionsByAddress` RPC method.
- A history result is bound only after the normal chain verifier confirms the
  exact network, recipient, amount, buyer relationship, data tag, execution
  result, and intent time window. A matching-looking but invalid transaction
  cannot poison the intent.
- Both synchronous status checks and the scheduled job call the same settlement
  function. Only that function can write `confirmed` or a conclusive `failed`.

The Worker cron runs every minute and processes at most 20 oldest
`pending`/`submitted` intents per invocation. RPC history is capped at 100
transactions, provider calls time out after four seconds, and the configured
fallback is used after the primary fails. These limits keep each invocation
bounded while repeated runs make progress idempotently.

## Browser resume behavior

The client stores the intent, recovery stage, and optional transaction hash in
local storage. It never stores the authenticated session token. On reopening a
product, the app automatically reconnects the original buyer wallet and checks
the existing intent before any new Buy action is available:

1. `hash_captured` resends only the stored hash, then verifies it.
2. `submitted` polls the existing hash.
3. `awaiting_wallet` asks the server to discover the unique tag.

Pending or unavailable network evidence shows **Check payment status** and an
explicit “do not pay again” message. A rejected payment blocks another checkout
and directs the buyer to the merchant. Verified evidence clears the local
recovery record.

## Expiry safety

An unpaid pending intent is eligible for expiry only after its displayed expiry
plus the two-minute chain-inclusion grace window. The cleanup update requires
both `status = 'pending'` and `transaction_hash IS NULL`, so a submitted or
concurrently discovered payment is never expired. Confirmed payments are not
part of the reconciliation query.

## Remaining physical-device gate

Keep issue #12 open until this is run in the Nimiq Pay mobile WebView on
TestAlbatross:

1. Approve the tagged payment and force-close the app before its hash reaches
   the API.
2. Reopen the same product and reconnect the buyer wallet.
3. Confirm the existing payment is discovered and settles after finality.
4. Confirm Nimiq Pay never opens a second native payment request and the buyer
   is charged only once.
5. Repeat by closing after the hash is returned but before submission completes;
   confirm only the saved hash is replayed.

Automated tests simulate both interruption points, but they do not substitute
for this native lifecycle and real-device payment check.
