# Hackathon submission package

## Description

NimTrace turns a NIM purchase into a durable, transferable product passport.
It is built for buyers of electronics, collectibles, tools, and other products
whose ownership, warranty, and repair history should outlive a paper receipt.
A merchant signs a product record, the buyer pays the merchant directly in
Nimiq Pay, and NimTrace independently verifies the tagged transaction before
issuing exactly one wallet-bound passport. Funds never pass through NimTrace.

Anyone can scan the passport QR without connecting a wallet to inspect the
issuer signature, payment evidence, warranty status, ownership state, and
append-only provenance timeline. Owners can gift a product to a specified
recipient wallet or sell it through another direct, tagged NIM payment.
Repairers can sign maintenance attestations, but the owner must acknowledge
them before they enter history. NimTrace clearly labels merchant claims and
signer attestations; it does not claim physical inspection, escrow, insurance,
or regulatory approval.

Nimiq is load-bearing throughout the product. Nimiq Pay supplies native wallet
signing and payment approval. Wallet addresses provide portable identity.
Transaction data binds payment to a server-created intent, while independent
Nimiq RPC checks prove recipient, exact Luna amount, execution, and finality.
Recipient-bound signatures keep transfers from being stolen or replayed.

The release is a mobile-first React Mini App with a Cloudflare Worker API, D1
state, cryptographic event chains, RPC fallback, explicit degraded states, and
automated lint, type, migration, unit, integration, and build gates. The public
demo uses a fixed repository-controlled image so it remains functional without
requiring paid R2 activation.

## Direct links

- Live Mini App: https://nimtrace-api.nimtrace.workers.dev
- Repository: https://github.com/EcstaceeLOR/NimTrace
- Demo video: add the final 60–90 second public recording URL
- Skool launch post: add the published post URL
- Public social post: add the published post URL
