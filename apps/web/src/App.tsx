import { useEffect, useState } from 'react'
import { HealthResponseSchema, type HealthResponse } from '@nimtrace/contracts'
import { authenticateWallet } from './lib/nimiq/auth'
import { nimiqPayWallet } from './lib/nimiq/wallet'
import { ProductIssuance } from './features/issuer/ProductIssuance'
import { PublicProductPage } from './features/products/PublicProductPage'
import { PassportCollection } from './features/passports/PassportCollection'
import { PublicPassportVerification } from './features/passports/PublicPassportVerification'
import { TransferAcceptance } from './features/passports/TransferAcceptance'

type ApiState =
  | { status: 'checking' }
  | { status: 'online'; health: HealthResponse }
  | { status: 'offline' }

type WalletState =
  | { status: 'idle' }
  | { status: 'authenticating' }
  | { status: 'connected'; address: string; sessionToken: string }
  | { status: 'cancelled' }
  | { status: 'outside'; deepLink: string }
  | { status: 'error'; message: string }

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' })
  const [wallet, setWallet] = useState<WalletState>({ status: 'idle' })
  const [showIssuer, setShowIssuer] = useState(false)
  const productRoute = /^\/products\/([^/]+)\/?$/.exec(window.location.pathname)
  const passportRoute = /^\/passports\/([^/]+)\/?$/.exec(window.location.pathname)
  const transferRoute = /^\/transfers\/([^/]+)\/?$/.exec(window.location.pathname)

  useEffect(() => {
    if (productRoute?.[1] || passportRoute?.[1] || transferRoute?.[1]) return
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
  }, [passportRoute, productRoute, transferRoute])

  async function viewPassports() {
    if (!nimiqPayWallet.isAvailable()) {
      setWallet({ status: 'outside', deepLink: nimiqPayWallet.deepLink() })
      return
    }

    setWallet({ status: 'authenticating' })
    const outcome = await authenticateWallet()

    if (outcome.status === 'success') {
      setWallet({
        status: 'connected',
        address: outcome.session.walletAddress,
        sessionToken: outcome.session.sessionToken,
      })
    } else if (outcome.status === 'cancelled') {
      setWallet({ status: 'cancelled' })
    } else {
      setWallet({ status: 'error', message: outcome.error.message })
    }
  }

  async function issueProduct() {
    if (wallet.status === 'connected') {
      setShowIssuer(true)
      return
    }
    if (!nimiqPayWallet.isAvailable()) {
      setWallet({ status: 'outside', deepLink: nimiqPayWallet.deepLink() })
      return
    }

    setWallet({ status: 'authenticating' })
    const outcome = await authenticateWallet()
    if (outcome.status === 'success') {
      setWallet({
        status: 'connected',
        address: outcome.session.walletAddress,
        sessionToken: outcome.session.sessionToken,
      })
      setShowIssuer(true)
    } else if (outcome.status === 'cancelled') {
      setWallet({ status: 'cancelled' })
    } else {
      setWallet({ status: 'error', message: outcome.error.message })
    }
  }

  if (productRoute?.[1]) {
    return <PublicProductPage productId={decodeURIComponent(productRoute[1])} />
  }

  if (passportRoute?.[1]) {
    return <PublicPassportVerification passportId={decodeURIComponent(passportRoute[1])} />
  }

  if (transferRoute?.[1]) {
    return <TransferAcceptance intentId={decodeURIComponent(transferRoute[1])} />
  }

  if (wallet.status === 'connected' && !showIssuer) {
    return (
      <main>
        <PassportCollection
          address={wallet.address}
          sessionToken={wallet.sessionToken}
          onBack={() => setWallet({ status: 'idle' })}
        />
      </main>
    )
  }

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
            <button
              className="button button--primary"
              type="button"
              disabled={wallet.status === 'authenticating'}
              onClick={() => void viewPassports()}
            >
              {wallet.status === 'authenticating' ? 'Waiting for Nimiq Pay…' : 'View my passports'}
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={wallet.status === 'authenticating'}
              onClick={() => void issueProduct()}
            >
              Issue a product
            </button>
          </div>
          {wallet.status === 'outside' && (
            <p className="wallet-notice" role="status">
              Public verification works here. To view wallet-owned passports,{' '}
              <a href={wallet.deepLink}>open NimTrace in Nimiq Pay</a>.
            </p>
          )}
          {wallet.status === 'connected' && (
            <p className="wallet-notice" role="status">Wallet connected: {wallet.address}</p>
          )}
          {wallet.status === 'cancelled' && (
            <p className="wallet-notice" role="status">Connection cancelled. Nothing was signed or paid.</p>
          )}
          {wallet.status === 'error' && (
            <p className="wallet-notice wallet-notice--error" role="alert">{wallet.message}</p>
          )}
          <p className="foundation-note">Wallet-ready foundation · Public verification never requires a connection.</p>
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
      {showIssuer && wallet.status === 'connected' && (
        <ProductIssuance
          sessionToken={wallet.sessionToken}
          onClose={() => setShowIssuer(false)}
        />
      )}
    </main>
  )
}
