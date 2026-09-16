import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { MerchantProductListResponseSchema, type MerchantProductSummary } from '@nimtrace/contracts'
import { formatNimFromLuna } from '../../lib/formatting/nim'

function publicUrl(id: string) {
  return `${window.location.origin}/products/${encodeURIComponent(id)}`
}

function ProductCard({ product }: { product: MerchantProductSummary }) {
  const [qr, setQr] = useState<string>()
  const [message, setMessage] = useState('')
  const url = publicUrl(product.id)

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: product.title, text: 'Verified product passport on NimTrace', url })
      else await navigator.clipboard.writeText(url)
      setMessage('Public link copied/shared.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setMessage('Copy the public URL from the address bar to share it.')
    }
  }

  async function showQr() {
    setQr(await QRCode.toDataURL(url, { errorCorrectionLevel: 'H', margin: 4, width: 360 }))
  }

  return (
    <article className="merchant-product-card">
      <div className="merchant-product-card__heading"><div><span className={`product-state product-state--${product.state}`}>{product.state}</span><h2>{product.title}</h2></div><strong>{formatNimFromLuna(product.priceLuna)}</strong></div>
      <dl>
        <div><dt>Warranty</dt><dd>{product.warrantyDurationDays} days</dd></div>
        <div><dt>Passport</dt><dd>{product.passportStatus ? `${product.passportStatus} · ${product.purchaserMasked ?? 'owner hidden'}` : 'Not purchased yet'}</dd></div>
        <div><dt>Issued</dt><dd>{new Date(product.issuedAt).toLocaleDateString()}</dd></div>
      </dl>
      <div className="merchant-product-card__actions"><a className="button button--secondary" href={`/products/${encodeURIComponent(product.id)}`}>Open listing</a><button className="button button--secondary" type="button" onClick={() => void share()}>Share link</button><button className="button button--secondary" type="button" onClick={() => void showQr()}>{qr ? 'Refresh QR' : 'Show QR'}</button></div>
      {message && <p className="issuer-help" role="status">{message}</p>}
      {qr && <img className="merchant-product-qr" src={qr} alt={`QR code for ${product.title}`} />}
    </article>
  )
}

export function MerchantCommandCenter({ onBack, sessionToken }: { onBack: () => void; sessionToken: string }) {
  const [items, setItems] = useState<MerchantProductSummary[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | MerchantProductSummary['state']>('all')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/merchant/products', { headers: { Authorization: `Bearer ${sessionToken}` }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        return MerchantProductListResponseSchema.parse(await response.json())
      })
      .then((value) => { setItems(value.items); setState('ready') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [sessionToken])

  const visible = useMemo(() => items.filter((item) => (filter === 'all' || item.state === filter) && item.title.toLowerCase().includes(query.trim().toLowerCase())), [filter, items, query])
  const counts = useMemo(() => ({ all: items.length, available: items.filter((item) => item.state === 'available').length, owned: items.filter((item) => item.state === 'owned').length }), [items])

  return (
    <section className="merchant-center" aria-labelledby="merchant-center-title">
      <header className="merchant-center__header"><div><p className="eyebrow">MERCHANT COMMAND CENTER</p><h1 id="merchant-center-title">Your product catalogue</h1><p>Live issuer records, purchase state, warranty terms, and shareable proof.</p></div><button className="button button--secondary" type="button" onClick={onBack}>Back home</button></header>
      <div className="merchant-center__toolbar"><input aria-label="Search catalogue" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" /><div className="merchant-filters">{(['all', 'available', 'owned'] as const).map((value) => <button key={value} className={filter === value ? 'is-active' : ''} type="button" onClick={() => setFilter(value)}>{value} <span>{counts[value]}</span></button>)}</div></div>
      {state === 'loading' && <p className="passport-collection-state" role="status">Loading your live catalogue…</p>}
      {state === 'error' && <p className="passport-collection-state" role="alert">The catalogue could not be loaded. Re-open the command center to retry.</p>}
      {state === 'ready' && visible.length === 0 && <div className="passport-collection-state"><h2>{items.length === 0 ? 'No products issued yet' : 'No matching products'}</h2><p>{items.length === 0 ? 'Issue your first signed product to create a durable listing.' : 'Try another search or filter.'}</p><a className="button button--primary" href="/issue">Issue a product</a></div>}
      {state === 'ready' && visible.length > 0 && <div className="merchant-product-grid">{visible.map((product) => <ProductCard key={product.id} product={product} />)}</div>}
    </section>
  )
}
