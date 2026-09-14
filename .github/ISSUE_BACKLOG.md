# Implementation Backlog

The live backlog is maintained in GitHub Issues under the **Cycle II
Submission** milestone. Work should be taken in dependency order.

## Foundation

1. Scaffold the React/Vite web app, Worker API, shared contracts, tests, and CI.
2. Create the D1 lifecycle schema and migrations.
3. Build the Nimiq Pay wallet adapter and normalized error model.
4. Implement signed-challenge wallet authentication.
5. Implement canonical payload hashing and signature verification.

## Purchase-to-passport vertical slice

6. Build merchant product issuance and immutable signed versions.
7. Add safe product-image upload and processing.
8. Build the public product page, QR, and Nimiq Pay deep link.
9. Implement buyer-bound purchase intents and compact transaction tags.
10. Implement direct tagged NIM checkout.
11. Independently verify NIM transactions against stored intents.
12. Reconcile interrupted and delayed payments safely.
13. Issue exactly one passport atomically after confirmation.
14. Build the wallet-owned passport collection and detail view.
15. Build the public passport verification experience.

## Transferable lifecycle

16. Implement recipient-bound, wallet-signed gift transfer.
17. Implement payment-backed resale transfer without custody.
18. Implement warranty state and presentation.
19. Implement repairer attestation and owner acknowledgement.

## Product quality and launch

20. Create the mobile-first NimTrace design system and motion language.
21. Complete accessibility, performance, and localization passes.
22. Add lifecycle unit, integration, E2E, and physical-device tests.
23. Deploy production with observability, health checks, and RPC fallback.
24. Prepare the demonstration, onboarding campaign, and usage measurement.
25. Complete competition compliance, privacy disclosure, and submission review.

P0 issues define the safe competition release. P1 issues are winning
differentiators that may ship only after the purchase-to-passport journey is
stable. P2 issues belong after the submission deadline.
