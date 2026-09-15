# NimTrace design system

NimTrace uses a dark, high-contrast “proof” language: the product passport is
the hero object, while mint indicates cryptographic verification, amber means
partial or delayed evidence, red means an invalid or failed state, and violet
means a merchant claim. These colors are always paired with text labels and
icons; status never relies on color alone.

## Tokens

The source of truth is `apps/web/src/styles.css`. Tokens cover:

- typography and readable line lengths;
- spacing (`--space-1` through `--space-7`);
- radii, borders, raised surfaces, and card/hero elevation;
- semantic verification colors (`--accent`, `--warning`, `--danger`, `--info`);
- motion durations (`--motion-fast`, `--motion-standard`, `--motion-slow`).

## Interaction rules

- Primary actions have a visible keyboard focus ring and a text label.
- Loading, cancellation, delayed, partial-verification, failure, and success
  states use live/status regions in the feature components.
- `prefers-reduced-motion: reduce` disables decorative movement and shimmer.
- Layouts start at 320px, use wrapping grids, and hide horizontal overflow so
  wallet addresses cannot create a sideways scroll.
- Public pages explain that NimTrace verifies signed history; they do not imply
  official Nimiq endorsement, escrow, inspection, or regulatory approval.
