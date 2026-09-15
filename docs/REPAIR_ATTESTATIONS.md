# Signed repair attestations

Repair history is a two-signature workflow. The current owner invites one
repairer wallet with a short expiry and a hash-chain head. The repairer signs
the service type, date, concise notes, passport ID, and previous event hash. The
owner then reviews that payload and signs an acknowledgement.

Only after both signatures verify does NimTrace append an immutable `repaired`
event. Corrections are new events; stored history is never edited. A public
passport labels the entry as a repairer signer attestation and explicitly does
not claim that NimTrace physically inspected the product.
