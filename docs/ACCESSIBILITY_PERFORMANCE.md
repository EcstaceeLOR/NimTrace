# Accessibility and performance release pass

- The initial locale is read from `window.nimiqPay.language`, reduced to a
  supported language, and falls back to English. The document language is set
  before the app becomes interactive.
- Every network loading/error/status state uses `role="status"` or
  `role="alert"`; controls have labels and visible keyboard focus rings.
- Verification states pair semantic text with color and an icon, so color is
  never the only signal.
- Product and passport images use responsive sizing, `decoding="async"`, and
  lazy loading for non-hero images. No remote fonts, blocking analytics, or
  wallet prompt is loaded by the public verification route.
- The production bundle is built with Vite and public verification is a
  static route in the same small client bundle.
