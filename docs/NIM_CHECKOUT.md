# Direct Nimiq Pay checkout

The public product page stays wallet-free until the visitor explicitly selects
**Buy with NIM**. Outside Nimiq Pay, that action is an encoded Mini App deep
link. Inside Nimiq Pay it starts signed wallet authentication, then asks the API
for a buyer-bound purchase intent.

## Payment review and execution

Before the native payment request, the buyer sees the product, full merchant
recipient, exact NIM amount, and warranty duration. The payment adapter receives
only these server intent fields:

```ts
await wallet.pay({
  recipient: intent.sellerAddress,
  valueLuna: intent.amountLuna,
  data: intent.transactionData,
  validityStartHeight: currentBlock,
})
```

NIM moves directly from buyer to merchant. NimTrace never receives or holds the
funds. An in-flight guard prevents repeated taps from opening a second native
payment request.

## Submission is not confirmation

When Nimiq Pay returns a hash, the client saves it locally before calling:

```http
POST /api/payment-intents/<intent-id>/submissions
Authorization: Bearer <buyer-session>
Content-Type: application/json

{"transactionHash":"<64 hex characters>"}
```

The authenticated endpoint binds the unique hash to the existing buyer intent
and moves only from `pending` to `submitted`. It does not accept recipient,
amount, tag, network, or a client-supplied paid flag, and it never marks the
purchase confirmed. Independent chain verification is the next gate.

A hash returned just after the intent display expiry is still preserved: the
wallet may already have broadcast the payment. Later verification must compare
the transaction's chain time and all stored expectations. An intent already
expired and replaced cannot be resubmitted through this endpoint.

## Recovery behavior

- Wallet cancellation clears the in-progress marker and confirms no funds moved.
- Consensus errors happen before payment and return to the review screen.
- A timeout, network loss, or delayed provider result after invoking payment
  blocks another payment and retains the unique tag for reconciliation.
- If a hash was captured but the API was offline, **Retry status update** sends
  only that same hash; it never calls the payment method again.
- Reloading with a captured hash asks the buyer to reauthenticate, verifies the
  same buyer wallet, and resumes hash submission without storing a bearer token.
- A successfully submitted hash is explicitly labelled as awaiting independent
  verification, not as a completed purchase.

## Physical-device gate

On a real Nimiq Pay phone, validate the following before closing issue #10:

1. Load a signed test product through the Nimiq Pay WebView.
2. Confirm no wallet request appears before **Buy with NIM**.
3. Compare recipient, amount, and transaction tag on the native approval screen
   with the stored intent.
4. Approve testnet payment and capture the returned hash in D1 as `submitted`.
5. Repeat with cancellation and confirm the Pay button safely returns.
6. Background and resume during approval; confirm only one native request opens.
7. Disable API connectivity after approval; restore it and verify that only the
   saved hash is retried.
