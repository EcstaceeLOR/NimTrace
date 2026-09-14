import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  PublicProductResponseSchema,
  type PublicProductResponse,
  type PublicProductState,
} from '@nimtrace/contracts'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { createNimiqPayDeepLink } from '../../lib/nimiq/deepLink'
import { ProductCheckout } from './ProductCheckout'

interface PublicProductPageProps {
  productId: string
}

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; product: PublicProductResponse }
  | { status: 'error'; message: string }

const stateCopy: Record<PublicProductState, { label: string; message: string }> = {
  available: { label: 'Available', message: 'This signed product is available to purchase directly from its issuer.' },
  owned: { label: 'Owned', message: 'This product has already been purchased. Its passport records the current owner.' },
  replaced: { label: 'Replaced version', message: 'You are viewing an older or retired product statement. Check the latest signed version.' },
  suspended: { label: 'Suspended', message: 'The issuer or NimTrace suspended this listing. Do not purchase it.' },
  invalid: { label: 'Invalid proof', message: 'The stored product proof could not be verified. Do not rely on this listing.' },
}

export function PublicProductPage({ productId }: PublicProductPageProps) {
  const [state, setState] = useState<PageState>({ status: 'loading' })
  const [qrCode, setQrCode] = useState<string>()
  const publicUrl = useMemo(() => `${window.location.origin}/products/${encodeURIComponent(productId)}`, [productId])
  const deepLink = useMemo(() => createNimiqPayDeepLink(publicUrl), [publicUrl])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/products/${encodeURIComponent(productId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Product not found.' : 'Product verification is unavailable.')
        return PublicProductResponseSchema.parse(await response.json())
      })
      .then((product) => setState({ status: 'ready', product }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Product verification failed.' })
        }
      })
    return () => controller.abort()
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
        <a className="brand" href="/"><span className="brand-mark">N</span>NimTrace</a>
        <section className="product-error" role="alert"><h1>Unable to verify product</h1><p>{state.message}</p></section>
      </main>
    )
  }

  const { product } = state
  const status = stateCopy[product.state]
  const purchasable = product.state === 'available' && product.signatureState === 'verified'

  return (
    <main className="public-product-shell">
      <nav className="public-product-nav">
        <a className="brand" href="/"><span className="brand-mark">N</span>NimTrace</a>
        <span className={`product-proof product-proof--${product.signatureState}`}>
          {product.signatureState === 'verified' ? '✓ Signature verified' : '× Signature invalid'}
        </span>
      </nav>

      <section className="public-product-grid">
        <div className="public-product-image"><img src={product.imageUrl} alt={product.title} /></div>
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
              <button className="button button--primary" type="button" disabled>Purchase unavailable</button>
              <a className="button button--secondary" href={deepLink}>Open in Nimiq Pay</a>
            </div>
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
        {qrCode && <img className="product-qr" src={qrCode} alt={`QR code for ${product.title} verification`} />}
      </section>
    </main>
  )
}
