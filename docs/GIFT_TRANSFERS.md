# Recipient-bound gift transfers

Gift transfers use two independent Nimiq Pay signatures and never move NIM.

1. The current owner requests an offer for one normalized recipient address.
   NimTrace locks the passport version, creates a 15-minute proof envelope, and
   asks the owner to sign the passport ID, version, recipient, zero price, nonce,
   and expiry.
2. The signed offer is stored as a pending recipient-bound intent. An unrelated
   wallet cannot create an acceptance challenge for it.
3. The recipient opens the transfer link inside Nimiq Pay, reviews the complete
   public passport proof, and signs the same transfer facts with an
   `ACCEPT_TRANSFER` envelope.
4. The API verifies both signatures, the derived wallet addresses, envelope
   network/action/nonce/expiry, current owner, passport version, and event head.
5. A D1 batch changes ownership, appends one hash-linked `transferred` event, and
   completes the intent. Replays, concurrent acceptance, stale versions, wrong
   recipients, and expired offers are rejected.

The former owner can still view historical evidence when history is requested,
but immediately loses owner actions. The recipient becomes the only current
owner after the event is committed.

The two-wallet acceptance gate requires opening the generated transfer link in
two real Nimiq Pay wallets. Automated coverage exercises the complete signed
flow and replay protection; it cannot replace that physical-device check.
