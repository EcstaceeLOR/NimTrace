import { useEffect, useMemo, useState } from 'react'
import { PublicProductListResponseSchema, type PublicProductResponse } from '@nimtrace/contracts'
import { ProductImage } from '../../components/ProductImage'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { MiniAppTabs } from '../../components/MiniAppTabs'

type CatalogueCategory = 'available' | 'checked_out' | 'completed'

const categoryCopy: Record<CatalogueCategory, { label: string; empty: string }> = {
  available: { label: 'Available', empty: 'No products are available to buy right now.' },
  checked_out: { label: 'Checked out', empty: 'No products currently have an active checkout.' },
  completed: { label: 'Completed', empty: 'No completed purchases yet.' },
}

function catalogueCategory(product: PublicProductResponse): CatalogueCategory | null {
  if (product.state === 'available') return 'available'
  if (product.state === 'checked_out') return 'checked_out'
  if (product.state === 'owned') return 'completed'
  return null
}

function ListingCard({ product }: { product: PublicProductResponse }) {
  const category = catalogueCategory(product) ?? 'available'
  const available = category === 'available'
  const stateMessage = available
    ? 'Ready for a new owner'
    : category === 'checked_out'
      ? 'Another buyer has an active checkout'
      : 'Purchase completed and ownership proof issued'

  return (
    <article className={`catalogue-card catalogue-card--${category}`}>
      <ProductImage src={product.imageUrl} alt={`${product.title} product`} className="catalogue-card__image" />
      <div className="catalogue-card__body">
        <span className={`product-state product-state--${category}`}>{categoryCopy[category].label}</span>
        <h2>{product.title}</h2>
        <p>{product.description || 'Payment-backed product passport.'}</p>
        <strong className="catalogue-price">{formatNimFromLuna(product.priceLuna)}</strong>
        <small>{product.warrantyDurationDays} days warranty · {stateMessage}</small>
        <a
          className={`button ${available ? 'button--primary' : 'button--secondary'}`}
          href={`/products/${encodeURIComponent(product.id)}`}
        >
          {available ? 'View listing and buy' : category === 'checked_out' ? 'View checked-out product' : 'View completed sale'}
        </a>
      </div>
    </article>
  )
}

export function ProductCatalogue() {
  const [items, setItems] = useState<PublicProductResponse[]>([])
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [category, setCategory] = useState<CatalogueCategory>('available')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const params = new URLSearchParams()
      if (submittedSearch) params.set('search', submittedSearch)
      params.set('live', String(Date.now()))
      try {
        const response = await fetch(`/api/products?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error()
        const value = PublicProductListResponseSchema.parse(await response.json())
        setItems(value.items)
        setState('ready')
      } catch {
        if (!controller.signal.aborted) setState('error')
      }
    }

    void load()
    const timer = window.setInterval(() => { void load() }, 10_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [submittedSearch])

  const categorized = useMemo(() => items.reduce<Record<CatalogueCategory, PublicProductResponse[]>>((groups, product) => {
    const productCategory = catalogueCategory(product)
    if (productCategory) groups[productCategory].push(product)
    return groups
  }, { available: [], checked_out: [], completed: [] }), [items])

  const heading = useMemo(() => {
    const prefix = submittedSearch ? `Results for “${submittedSearch}”` : 'Public product marketplace'
    return `${prefix} · ${categoryCopy[category].label}`
  }, [category, submittedSearch])

  const visibleItems = categorized[category]

  return (
    <main className="catalogue-shell">
      <nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/verify">Verify</a><a href="/issue">Issue</a><a href="/wallet">My passports</a></div></nav>
      <section className="catalogue-hero"><p className="eyebrow">PUBLIC PRODUCT CATALOGUE</p><h1>Buy products with proof that follows.</h1><p>See what is available now, what is already in checkout, and what has completed ownership transfer.</p><form onSubmit={(event) => { event.preventDefault(); setState('loading'); setSubmittedSearch(search.trim()) }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /><button className="button button--primary">Search</button></form></section>

      <section className="catalogue-results" aria-live="polite">
        <div className="catalogue-lifecycle" role="group" aria-label="Product availability categories">
          {(['available', 'checked_out', 'completed'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`catalogue-lifecycle__button${category === value ? ' catalogue-lifecycle__button--active' : ''}`}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              <span>{categoryCopy[value].label}</span>
              <strong>{categorized[value].length}</strong>
            </button>
          ))}
        </div>

        <div className="catalogue-results__heading"><h2>{heading}</h2><span>{visibleItems.length} listing{visibleItems.length === 1 ? '' : 's'}</span></div>
        {state === 'loading' && <p className="passport-collection-state" role="status">Loading live product states…</p>}
        {state === 'error' && <p className="passport-collection-state" role="alert">Listings are temporarily unavailable. Try again in a moment.</p>}
        {state === 'ready' && visibleItems.length === 0 && (
          <div className="passport-collection-state">
            <h2>{categoryCopy[category].empty}</h2>
            <p>The catalogue refreshes automatically as checkout and ownership states change.</p>
            {category === 'available' && items.length === 0 && <a className="button button--secondary" href="/issue">Issue a product</a>}
          </div>
        )}
        {state === 'ready' && visibleItems.length > 0 && <div className="catalogue-grid">{visibleItems.map((product) => <ListingCard key={product.id} product={product} />)}</div>}
      </section>
      <MiniAppTabs />
    </main>
  )
}
