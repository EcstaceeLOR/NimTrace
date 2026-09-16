import { useEffect, useMemo, useState } from 'react'
import { PublicProductListResponseSchema, type PublicProductResponse } from '@nimtrace/contracts'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { MiniAppTabs } from '../../components/MiniAppTabs'

function ListingCard({ product }: { product: PublicProductResponse }) {
  return (
    <article className="catalogue-card">
      <img src={product.imageUrl} alt="" loading="lazy" decoding="async" />
      <div className="catalogue-card__body">
        <span className="product-state product-state--available">Available</span>
        <h2>{product.title}</h2>
        <p>{product.description || 'Payment-backed product passport.'}</p>
        <strong className="catalogue-price">{formatNimFromLuna(product.priceLuna)}</strong>
        <small>{product.warrantyDurationDays} days warranty · Signed by issuer</small>
        <a className="button button--primary" href={`/products/${encodeURIComponent(product.id)}`}>View listing and buy</a>
      </div>
    </article>
  )
}

export function ProductCatalogue() {
  const [items, setItems] = useState<PublicProductResponse[]>([])
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    const query = submittedSearch ? `?search=${encodeURIComponent(submittedSearch)}` : ''
    setState('loading')
    void fetch(`/api/products${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        return PublicProductListResponseSchema.parse(await response.json())
      })
      .then((value) => { setItems(value.items); setState('ready') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [submittedSearch])

  const heading = useMemo(() => submittedSearch ? `Results for “${submittedSearch}”` : 'Products ready for a new owner', [submittedSearch])

  return (
    <main className="catalogue-shell">
      <nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/verify">Verify</a><a href="/issue">Issue</a><a href="/wallet">My passports</a></div></nav>
      <section className="catalogue-hero"><p className="eyebrow">PUBLIC PRODUCT CATALOGUE</p><h1>Buy products with proof that follows.</h1><p>Browse signed listings without a wallet. Connect only when you choose to pay in NIM.</p><form onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(search.trim()) }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /><button className="button button--primary">Search</button></form></section>
      <section className="catalogue-results" aria-live="polite"><div className="catalogue-results__heading"><h2>{heading}</h2><span>{items.length} listing{items.length === 1 ? '' : 's'}</span></div>{state === 'loading' && <p className="passport-collection-state" role="status">Loading signed listings…</p>}{state === 'error' && <p className="passport-collection-state" role="alert">Listings are temporarily unavailable. Try again in a moment.</p>}{state === 'ready' && items.length === 0 && <div className="passport-collection-state"><h2>No available listings</h2><p>Issuers can publish a product from the Merchant Studio.</p><a className="button button--secondary" href="/issue">Issue a product</a></div>}{state === 'ready' && items.length > 0 && <div className="catalogue-grid">{items.map((product) => <ListingCard key={product.id} product={product} />)}</div>}</section>
      <MiniAppTabs />
    </main>
  )
}
