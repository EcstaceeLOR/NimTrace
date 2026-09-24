import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  PublicProductResponseSchema,
  type PublicProductResponse,
  type PublicProductState,
} from '@nimtrace/contracts'
import { ProductImage } from '../../components/ProductImage'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { ProductCheckout } from './ProductCheckout'
import { PaymentProgress } from './PaymentProgress'
import { MiniAppTabs } from '../../components/MiniAppTabs'

interface PublicProductPageProps {
  productId: string
}

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; product: PublicProductResponse }
  | { status: 'error'; message: string }

const stateCopy: Record<PublicProductState, { label: string; message: string }> = {
  available: { label: 'Available', message: 'This signed product has no active checkout and is available to purchase directly from its issuer.' },
  checked_out: { label: 'Checkout in progress', message: 'Another buyer currently has an active checkout for this product. Buying is disabled until that checkout completes, expires, or safely fails.' },
  owned: { label: 'Completed', message: 'This purchase has completed and its product passport records the current owner.' },
  replaced: { label: 'Replaced version', message: 'You are viewing an older or retired product statement. Check the latest signed version.' },
  suspended: { label: 'Suspended', message: 'The issuer or NimTrace suspended this listing. Do not purchase it.' },
  invalid: { label: 'Invalid proof', message: 'The stored product proof could not be verified. Do not rely on this listing.' },
}

export function PublicProductPage({ productId }: PublicProductPageProps) {
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [qrCode, setQrCode] = useState<string>()
  const publicUrl = useMemo(() => `${window.location.origin}/products/${encodeURIComponent(productId)}`, [productId])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    async function loadProduct() {
      const params = new URLSearchParams({ live: String(Date.now()) })
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(response.status === 404 ? 'Product not found.' : 'Product verification is unavailable.')
        const product = PublicProductResponseSchema.parse(await response.json())
        if (stopped) return
        setState({ status: 'ready', product })
        if (product.state === 'checked_out') {
          refreshTimer = setTimeout(() => void loadProduct(), 5_000)
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted && !stopped) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Product verification failed.' })
        }
      }
    }

    void loadProduct()
    return () => {
      stopped = true
      controller.abort()
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [productId])

  useEffect(() => {
    void QRCode.toDataURL(publicUrl, {
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 512,
      color: { dark: '#090b10', light: '#ffffff' },
    }).then(setQrCode)
  }, [publicUrl])

  if (state.status === 'loading') {
    return <main className="public-product-shell"><p className="product-loading" role="status">Verifying signed product…</p></main>
  }
  if (state.status === 'error') {
    return (
      <main className="public-product-shell">
        <a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a>
        <section className="product-error" role="alert"><h1>Unable to verify product</h1><p>{state.message}</p></section>
      </main>
    )
  }

  const { product } = state
  const status = stateCopy[product.state]
  const purchasable = product.state === 'available' && product.signatureState === 'verified'
  const unavailableLabel = product.state === 'checked_out'
    ? 'Checkout in progress'
    : product.state === 'owned'
      ? 'Purchase completed'
      : 'Purchase unavailable'

  return (
    <main className="public-product-shell">
      <nav className="public-product-nav">
        <a className="brand" href="/"><span className="brand-mark">N</span>NimTrace</a>
        <span className={`product-proof product-proof--${product.signatureState}`}>
          {product.signatureState === 'verified' ? '✓ Signature verified' : '× Signature invalid'}
        </span>
      </nav>

      <section className="public-product-grid">
        <ProductImage src={product.imageUrl} alt={`${product.title} product`} className="public-product-image" loading="eager" fetchPriority="high" />
        <article className="public-product-card">
          <p className={`product-state product-state--${product.state}`}>{status.label}</p>
          <h1>{product.title}</h1>
          <p className="product-description">{product.description}</p>
          <p className="product-price">{formatNimFromLuna(product.priceLuna)}</p>
          <p className="product-state-message">{status.message}</p>

          <dl className="product-facts">
            <div><dt>Issuer wallet</dt><dd>{product.issuerAddress}</dd></div>
            <div><dt>Serial fingerprint</dt><dd>{product.serialFingerprint}</dd></div>
            <div><dt>Warranty</dt><dd>{product.warrantyDurationDays} days</dd></div>
            <div><dt>Signed version</dt><dd>v{product.version}{product.version < product.currentVersion ? ` of ${product.currentVersion}` : ''}</dd></div>
          </dl>
          <div className="warranty-claim"><strong>Merchant warranty statement</strong><p>{product.warrantySummary}</p></div>

          {purchasable ? <ProductCheckout product={product} publicUrl={publicUrl} /> : (
            <div className="product-actions">
              <button className="button button--primary" type="button" disabled>{unavailableLabel}</button>
            </div>
          )}

          {product.state === 'checked_out' && (
            <section className="public-checkout-progress" aria-labelledby="public-checkout-progress-title">
              <p className="eyebrow">LIVE CHECKOUT</p>
              <h2 id="public-checkout-progress-title">Purchase progress</h2>
              <p>NimTrace checks the active payment on-chain every few seconds. Buyer identity, payment tag, and transaction hash stay private.</p>
              <PaymentProgress publicProgress={product.checkoutProgress} />
              {product.checkoutProgress && (
                <small>Last checked {new Date(product.checkoutProgress.checkedAt).toLocaleTimeString()}.</small>
              )}
            </section>
          )}

          <p className="product-trust-note">Payment will go directly to the issuer. NimTrace does not provide escrow or independently inspect the physical item.</p>
        </article>
      </section>

      <section className="product-proof-details" aria-labelledby="proof-title">
        <div>
          <p className="eyebrow">PUBLIC PROOF</p>
          <h2 id="proof-title">Scan to verify anywhere.</h2>
          <p>This HTTPS link opens without a wallet. The QR uses high error correction and a print-safe quiet zone.</p>
          <code>{product.proofHash.slice(0, 20)}…</code>
          <button className="print-link" type="button" onClick={() => window.print()}>Print verification QR</button>
        </div>
        {qrCode && <img className="product-qr" src={qrCode} alt={`QR code for ${product.title} verification`} loading="lazy" decoding="async" />}
      </section>
      <MiniAppTabs />
    </main>
  )
}
