# Buyer-bound purchase intents

NimTrace creates a payment expectation before Nimiq Pay is allowed to move
funds. The authenticated buyer requests an intent with:

```http
POST /api/products/<product-id>/purchase-intents
Authorization: Bearer <wallet-session>
Idempotency-Key: <16-128 URL-safe characters>
Content-Type: application/json

{}
```

The body is deliberately empty. The server reads the current verified signed
product version and derives the buyer, seller, exact integer Luna amount,
configured Nimiq network, transaction tag, and expiry. Any attempt to provide
or override those values is rejected. D1 triggers make those terms immutable
after insertion.

## Compact transaction tag

Nimiq basic transactions allow at most 64 bytes of unstructured data. A
purchase tag has this format:

```text
NTP1:<24-character base64url intent ID>
```

The tag is 29 ASCII bytes. The intent ID contains 144 random bits, the complete
tag has a unique database constraint, and the exact tag is later compared with
on-chain transaction data. It contains no wallet address, token, or other
secret.

## Idempotency and expiry

Only the SHA-256 hash of the idempotency key is stored. Repeating the same key
for the same authenticated buyer returns the original intent. Reusing that key
for a different request is rejected. A physical product can have only one
`pending`, `submitted`, or `confirmed` initial-purchase intent, preventing two
buyers from being invited to pay and keeping a confirmed payment locked until
passport settlement completes.

An unpaid `pending` intent can become `expired`, after which a new key creates a
fresh intent and tag. A `submitted` intent is not automatically expired because
funds may already have moved and must be reconciled first.

Allowed state transitions are `pending -> submitted`, `pending -> expired`,
`pending -> failed`, `pending -> cancelled`, `submitted -> confirmed`, and
`submitted -> failed`.

Terminal states cannot transition back to a payable state. Submission requires
a transaction hash, confirmation requires the matching hash and block evidence,
and failure requires a stable failure code.
