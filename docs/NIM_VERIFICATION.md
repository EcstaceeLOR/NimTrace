# Independent NIM payment verification

`GET /api/payment-intents/<intent-id>/verification` and the scheduled
reconciler enter the same settlement function, which is the only code path that
can move a submitted purchase to `confirmed`. The HTTP caller must authenticate
as the buyer that owns the stored intent. Client claims, display state, and
values in the request are never used as payment evidence.

## Chain checks

For a submitted hash, the verifier makes only the read-only
`getTransactionByHash` JSON-RPC call and compares the response with the
immutable D1 intent. Pending intents without a hash may first be discovered
with bounded `getTransactionsByAddress` history; every discovered candidate is
passed through these same checks before its hash is stored. It requires:

- the returned hash to equal the submitted, database-unique hash;
- `executionResult: true` (or the equivalent included/confirmed state);
- the transaction network ID to be MainAlbatross (`24`) or TestAlbatross (`5`)
  as stored on the intent;
- the exact merchant recipient and integer Luna value;
- the transaction's raw recipient data to decode to the exact intent tag;
- the authenticated buyer to appear in `relatedAddresses`, or in decoded HTLC
  proof context when a newer provider exposes it;
- a block timestamp between intent creation (with 30 seconds of block-clock
  tolerance) and two minutes after the displayed expiry; and
- at least 60 confirmations.

The 60-confirmation threshold is intentionally conservative. An Albatross
batch contains 59 micro blocks and closes with a macro block; that macro block
finalizes the preceding micro-block transactions. Waiting 60 confirmations
therefore carries a payment beyond its next macro-block finality point without
depending on a provider-specific `confirmed` interpretation.

An HTLC payout is not required to have the buyer wallet as its direct `from`
address. The sender can be the HTLC contract. The verifier uses the RPC's
related participant set instead, preventing both false rejection of routed
payments and acceptance based only on a payout sender assumption.

## Result states

- `verified`: every invariant matches and macro-block finality is satisfied;
- `pending`: no hash is submitted, the transaction is not visible/included, or
  finality has not yet been reached;
- `rejected`: the chain transaction exists but fails a stored invariant, or the
  intent is already inactive;
- `inconclusive`: providers are unavailable, return malformed data, or do not
  expose enough relationship/finality evidence.

Only `verified` writes `confirmed`. A conclusive mismatch writes `failed` with
its reason. `pending` and `inconclusive` remain retryable and never release a
product or manufacture ownership.

## RPC availability

Set `NIMIQ_RPC_PRIMARY_URL` to a production history-node endpoint. Optionally
set `NIMIQ_RPC_FALLBACK_URL` to an independently operated read-only endpoint.
Each provider is attempted at most twice with a four-second timeout. The
fallback is tried only after the primary cannot produce a usable transaction.

When no fallback is configured, NimTrace uses the community endpoint listed by
the official Nimiq Developer Center for the selected network. That public
server has no uptime SLA, so production deployment must configure an
independent primary rather than treating the community service as the only
availability layer.

Tests do not depend on live RPC uptime. The committed fixtures were captured
from the public TestAlbatross history node with `getTransactionByHash` and
include a normal data-bearing transfer plus a real regular HTLC payout. Their
hashes, block heights, complete participant sets, raw data, and proofs remain
unchanged from the RPC responses.
