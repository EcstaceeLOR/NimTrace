# NimTrace Functional Specification

## 1. Product definition

NimTrace is a Nimiq Pay Mini App for payment-backed ownership of physical
products. It gives merchants a lightweight issuance tool, buyers a wallet-owned
passport collection, and anyone a public product-verification experience.

### Product promise

> A NIM purchase creates verifiable ownership that can travel with the product.

### Non-goals

NimTrace is not:

- a generic receipt or bookkeeping application;
- an NFT marketplace;
- an escrow or dispute-resolution service;
- proof that a physical product is genuine without an accountable issuer;
- a replacement for consumer-protection law;
- a repository for customer identity or shipping information.

## 2. Actors

### Visitor / verifier

Scans a QR code and checks a passport without connecting a wallet.

### Merchant / issuer

Creates a unique physical product record, signs its initial version, sets its
price and warranty, and receives payment directly.

### Buyer / owner

Pays for the product, receives its passport, presents warranty evidence, and
initiates later transfers.

### Recipient / resale buyer

Accepts a recipient-bound transfer and, for resale, pays the current owner.

### Repairer

Adds a signed service statement after receiving a passport-specific invitation.

One wallet may act in more than one role.

## 3. Navigation

Primary mobile navigation contains only:

- **Passports** — products currently owned by the connected wallet;
- **Issue** — merchant product creation and issued inventory;
- **Activity** — pending payments, transfers, warranty events, and repairs;
- **Profile** — public display name, language, privacy, and support.

Public product, checkout, transfer, and verification links bypass the main
navigation and open directly into the relevant task.

## 4. Functional requirements

### F-01 Public product page

Before wallet connection, a visitor can see:

- product title and image;
- issuer display name and masked wallet address;
- exact NIM price and approximate fiat value;
- warranty duration and plain-language coverage supplied by the merchant;
- product serial fingerprint;
- issuer-signature status;
- prominent **Buy with NIM** action.

The page must not call a provider until the user chooses a wallet action.

### F-02 Wallet connection and authentication

- The app requests accounts through Nimiq Pay.
- The selected wallet address is displayed in user-friendly form.
- Mutating actions require a signed, single-use authentication challenge.
- Cancellation keeps the user on the same screen and explains that nothing was
  signed or paid.
- Outside Nimiq Pay, public views remain usable and wallet actions show an
  Nimiq Pay deep link.

### F-03 Merchant profile

- Wallet address is the authoritative profile identifier.
- Display name, avatar, and short description are optional.
- The UI states that NimTrace has not legally verified a merchant unless a
  future verification program explicitly does so.
- Issuer history and suspended products remain visible to passport holders.

### F-04 Product creation and signing

Required fields:

- product title;
- one image;
- unique serial or merchant reference;
- price in NIM;
- warranty duration;
- warranty summary.

The merchant reviews a human-readable summary and signs the deterministic
product hash. Drafts are not public and cannot be purchased. A signed product
version cannot be edited; changes create a clearly marked replacement version.

### F-05 Product QR and share link

- Every signed product receives a QR code and HTTPS URL.
- The link works in an ordinary browser for read-only viewing.
- A supported action opens the product inside Nimiq Pay.
- QR exports include sufficient quiet zone and contrast for physical printing.

### F-06 Purchase intent

- Buyer must authenticate before an intent is created.
- Intent is bound to buyer, seller, product version, exact integer Luna value,
  expected transaction data, network, and expiry.
- Review screen shows product, recipient, amount, and warranty before invoking
  Nimiq Pay.
- Expired intents cannot be paid; the app safely creates a fresh intent.

### F-07 NIM payment

- Payment uses `sendBasicTransactionWithData()`.
- Funds go directly to the merchant wallet.
- The compact intent reference is included in transaction data.
- User rejection is treated as cancellation, not failure.
- The Pay button disables while a request is outstanding.
- A submitted transaction is reconciled before the user can retry.

### F-08 Payment verification

The server independently verifies transaction execution, network, uniqueness,
recipient, amount, intent tag, and available buyer relationship data. It never
accepts a client boolean such as `paid: true`.

UI states:

- waiting for wallet approval;
- transaction submitted;
- confirming on Nimiq;
- confirmed and passport issued;
- confirmation delayed;
- cancelled;
- failed with a safe retry path.

### F-09 Passport issuance

After payment confirmation, NimTrace atomically creates:

- a passport owned by the buyer wallet;
- an `ISSUED` event referencing product version and payment;
- warranty start and expiry dates;
- a public verification identifier.

The same transaction cannot issue two passports. Repeating a completion request
returns the original passport.

### F-10 Owner passport collection

The owner sees:

- product image and title;
- verified issuer;
- current ownership state;
- warranty countdown;
- purchase transaction link;
- repair count;
- pending transfer or warranty action.

No manual “add passport” action can fabricate ownership.

### F-11 Public verification

The QR verification page displays:

- overall verification status;
- exact distinction between cryptographic facts and merchant claims;
- issuer wallet and signature status;
- purchase transaction status;
- masked current owner;
- warranty state;
- append-only lifecycle timeline;
- signed repair records;
- last verification time and degraded RPC state, if applicable.

The route requires no login and loads quickly on mobile data.

### F-12 Gift transfer

- Owner enters or scans the recipient's Nimiq address.
- Transfer is locked to that recipient and expires.
- Owner signs a readable transfer offer.
- Recipient reviews product history and signs acceptance.
- Ownership changes once, atomically, after both signatures validate.
- Both wallets see the completed transfer event.
- Old owner retains read-only historical evidence but loses owner actions.

### F-13 Paid resale

- Owner creates a recipient-bound offer with exact NIM price and expiry.
- Recipient signs acceptance and pays current owner directly.
- Resale transaction carries its transfer payment-intent reference.
- Payment is independently verified before ownership changes.
- UI explicitly states there is no escrow or reversal.
- Offer cannot be reused after completion or expiry.

### F-14 Warranty presentation

- Passport automatically displays active, expiring, expired, or suspended.
- Owner can generate a short-lived warranty-presentation QR.
- Merchant can scan it to see the applicable signed product version and purchase.
- Creating a claim does not imply that the merchant accepted liability.
- Claim status changes create visible lifecycle events.

### F-15 Repair attestation

- Owner invites a repairer by wallet address.
- Repairer records service type, date, and concise notes.
- Repairer signs the record.
- Owner reviews and acknowledges it before it joins the passport timeline.
- Corrections append another signed event; they do not replace history.

### F-16 Activity and recovery

Activity shows actionable states for:

- pending purchases;
- submitted payments awaiting confirmation;
- transfer invitations;
- paid transfers awaiting finalization;
- warranty presentations;
- repair acknowledgements.

Opening the app triggers safe reconciliation of incomplete payment flows.

### F-17 Localization and accessibility

- Initial language follows `window.nimiqPay.language` with English fallback.
- Competition release provides English; translation structure is ready for more.
- All flows support keyboard focus, screen-reader labels, high contrast, and
  reduced motion.
- Amounts, dates, and addresses cannot be distinguished by color alone.

### F-18 Consent and privacy

- Product and passport public visibility is explained before issuance.
- Raw device identifier is never displayed publicly or used as identity.
- Image, wallet, and analytics collection are disclosed.
- A public passport masks owner addresses unless the owner deliberately reveals
  the full address for a transaction or verification action.

## 5. Experience requirements

### First 60 seconds

A first-time judge opening a demo product must be able to:

1. understand that this is a physical-product passport;
2. see who issued it and its warranty;
3. connect a wallet;
4. reach the native NIM payment confirmation;
5. understand what passport will be issued after payment.

### Visual language

- The passport is the hero object, not a dashboard card.
- Product lifecycle is a vertical provenance timeline.
- Verification uses restrained, explicit states rather than decorative badges.
- Nimiq's visual language may inform colors and motion, but NimTrace remains its
  own product and does not imply official Nimiq endorsement.
- Confirmation animation should show the product moving into a wallet-shaped
  collection, followed by the warranty countdown becoming active.

### Performance targets

- Public verification page usable within 2 seconds on typical mobile data.
- Initial JavaScript kept below an agreed release budget.
- Product images resized and converted before upload.
- No blocking analytics or third-party font request.
- Wallet request begins only after an explicit tap.

## 6. Competition release scope

### P0 — submission blocking

- Wallet connection and signed authentication
- Merchant product issuance and signature
- Public product QR/link
- Tagged direct NIM purchase
- Independent payment verification and recovery
- Passport issuance and owner collection
- Public verification page
- Recipient-bound gift transfer
- Warranty state
- Real-device error handling

### P1 — winning differentiators

- Paid resale transfer
- Repairer and owner co-signed repair record
- Exceptional passport animation and lifecycle timeline
- Demo merchant catalogue with real products
- Usage analytics based on consented, privacy-safe unique-wallet opens

### P2 — after submission

- Merchant analytics
- Printable label designer
- Multiple images and manuals
- Merchant/team roles
- Warranty claim workflow automation
- Additional languages
- USDT purchases

## 7. Success metrics

### Competition

- 25 or more legitimate unique Nimiq wallets open the Mini App.
- At least 10 wallets complete a signed or payment-backed action.
- At least 5 complete purchase-passport journeys.
- At least 3 cross-wallet passport transfers.
- Zero unresolved critical failures during judging.
- One public build post and one public social launch post.

### Product quality

- At least 90% purchase-flow completion after wallet connection.
- No duplicate passports from replayed transactions.
- Public verification returns a meaningful state during RPC degradation.
- Median verification-page load under 2 seconds.
- Every production error state gives a next action.

## 8. Release acceptance scenario

The competition build is acceptable only when this scenario succeeds on real
phones:

1. Merchant wallet creates and signs a headphone passport.
2. Buyer wallet scans its QR and pays 1 NIM.
3. Server verifies the transaction and issues the passport.
4. A logged-out browser verifies issuer, purchase, owner, and warranty.
5. Buyer signs a transfer to a second wallet.
6. Second wallet accepts; the public page changes owner exactly once.
7. Original buyer can no longer initiate owner-only actions.
8. Cancelling any wallet dialog leaves both money and ownership state correct.
