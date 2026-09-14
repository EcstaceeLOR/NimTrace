import { useEffect, useState } from 'react'
import { HealthResponseSchema, type HealthResponse } from '@nimtrace/contracts'

type ApiState =
  | { status: 'checking' }
  | { status: 'online'; health: HealthResponse }
  | { status: 'offline' }

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' })

  useEffect(() => {
    const controller = new AbortController()

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`)
        const health = HealthResponseSchema.parse(await response.json())
        setApi({ status: 'online', health })
      } catch {
        if (!controller.signal.aborted) setApi({ status: 'offline' })
      }
    }

    void checkHealth()
    return () => controller.abort()
  }, [])

  return (
    <main>
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="NimTrace home">
          <span className="brand-mark" aria-hidden="true">N</span>
          NimTrace
        </a>
        <span className={`status status--${api.status}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {api.status === 'online' ? 'Network ready' : api.status === 'offline' ? 'API unavailable' : 'Connecting'}
        </span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">OWNERSHIP, PROVEN</p>
          <h1>Every product deserves proof that lasts.</h1>
          <p className="lede">
            Payment-backed ownership, warranty, and service history—carried safely from one wallet to the next.
          </p>
          <div className="actions">
            <button className="button button--primary" type="button">View my passports</button>
            <button className="button button--secondary" type="button">Verify a product</button>
          </div>
          <p className="foundation-note">Foundation preview · Wallet features arrive in the next vertical slice.</p>
        </div>

        <article className="passport" aria-label="Example product passport">
          <div className="passport-glow" aria-hidden="true" />
          <header className="passport-header">
            <span>PRODUCT PASSPORT</span>
            <span className="verified">✓ VERIFIED</span>
          </header>
          <div className="product-art" aria-hidden="true">
            <div className="product-orbit" />
            <div className="product-core">N</div>
          </div>
          <div className="passport-body">
            <p className="passport-label">NIMTRACE ORIGINAL</p>
            <h2>Genesis Edition</h2>
            <dl>
              <div><dt>Ownership</dt><dd>Payment backed</dd></div>
              <div><dt>Warranty</dt><dd className="active">Active</dd></div>
              <div><dt>History</dt><dd>Authentic</dd></div>
            </dl>
          </div>
        </article>
      </section>
    </main>
  )
}
