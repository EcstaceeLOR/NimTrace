# Public product verification

Every published product has a wallet-free verification route:

```text
https://<deployment-host>/products/<product-id>
```

The page exposes the signed product statement, exact price in NIM, issuer
address, serial-number fingerprint, warranty, signed version, and proof state.
It does not initialize Nimiq Pay or request wallet access while loading. Wallet
interaction starts only after a visitor selects **Buy with NIM** or
**Open in Nimiq Pay**.

## Verification states

- `available`: the current proof is valid and the product can be purchased.
- `owned`: the valid product has already been sold.
- `replaced`: the URL points to an older or retired signed version.
- `suspended`: the listing has been suspended and must not be purchased.
- `invalid`: the stored signature or proof data failed verification.

Only a product whose state is `available` and whose signature is `verified`
offers the purchase action. All other states remain visible and explain why
purchase is unavailable.

## QR and deep link

The QR contains the ordinary HTTPS product URL so any modern camera can open it
without requiring Nimiq Pay. It is rendered at 512 pixels with high error
correction, a four-module quiet zone, and solid black-on-white colors for phone
and print scanning. Print styles isolate the public proof and QR from controls.

The explicit action uses this encoded handoff:

```text
nimiqpay://miniapp?url=<encoded-https-product-url>
```

Payment remains direct from the buyer to the issuer. NimTrace does not provide
escrow and does not independently inspect the physical item.
