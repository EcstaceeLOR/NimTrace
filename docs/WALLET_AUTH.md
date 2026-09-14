# Signed wallet authentication

NimTrace authenticates a wallet with a short-lived, single-use challenge. It
does not ask for a password, transfer funds, or expose the wallet's private key.

## Flow

1. The client requests a challenge for the selected wallet address.
2. The API normalizes the address, creates a cryptographically random nonce,
   and stores a SHA-256 hash of a readable message for five minutes.
3. Nimiq Pay shows that exact message and asks the user to sign it.
4. The API reconstructs the message, verifies its hash and Ed25519 signature,
   derives the signer address from the public key, and compares the address and
   configured Nimiq network.
5. A successful session insert atomically consumes the challenge. The API
   returns the session token once and stores only its SHA-256 hash.

The signed-message digest follows Nimiq's convention: SHA-256 over
`\x16Nimiq Signed Message:\n`, the decimal UTF-8 message length, and the UTF-8
message itself.

## Replay and expiry behavior

Challenges expire after five minutes and can create exactly one session. A D1
trigger checks availability and consumes the challenge in the same SQLite
statement as session creation, so concurrent replay attempts cannot both win.
Expired and already-used requests return stable, recoverable error codes. A
cancelled Nimiq Pay prompt creates no session and the user can retry safely.

Session tokens expire after 24 hours. The current client keeps the returned
token in React memory only; it is not written to local storage.
