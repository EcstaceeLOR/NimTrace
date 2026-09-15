# Payment-backed resale transfers

A resale uses the same recipient-bound offer as a gift, with a nonzero Luna
price. The owner signs the exact recipient, price, passport version, nonce, and
expiry. The recipient signs acceptance before any payment request appears.

The API then creates a `resale` payment intent whose seller is the current
owner, buyer is the recipient, amount is the signed price, and transaction data
is a unique `NTR2:` transfer tag. The recipient pays that address directly from
Nimiq Pay. NimTrace never receives, escrows, or reverses the funds.

Ownership is not changed when the payment is submitted. The completion endpoint
re-reads the intent and independently verifies recipient, amount, tag, network,
execution, timestamp, and finality through read-only RPC. Only a verified final
payment can append the linked `transferred` event and complete the intent.

If the app closes after broadcast, the submitted intent remains reconcilable by
its unique tag and transaction hash. Repeated submission, payment reuse,
recipient mismatch, stale passport versions, and replayed acceptance are
rejected.
