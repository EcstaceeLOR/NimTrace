import { type FormEvent, useEffect, useState } from 'react'
import { HealthResponseSchema, type HealthResponse } from '@nimtrace/contracts'
import { authenticateWallet } from './lib/nimiq/auth'
import { nimiqPayWallet } from './lib/nimiq/wallet'
import { ProductIssuance } from './features/issuer/ProductIssuance'
import { PublicProductPage } from './features/products/PublicProductPage'
import { PassportCollection } from './features/passports/PassportCollection'
import { PublicPassportVerification } from './features/passports/PublicPassportVerification'
import { TransferAcceptance } from './features/passports/TransferAcceptance'
import { MerchantPresentation } from './features/passports/MerchantPresentation'
import { applyAppLanguage } from './lib/i18n'

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

type WalletReadiness =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ready'; blockNumber: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

function MiniAppTabs() {
  const path = window.location.pathname
  const links = [
    ['/', 'Home'],
    ['/verify', 'Verify'],
    ['/issue', 'Issue'],
    ['/wallet', 'Wallet'],
  ] as const
  return <nav className="miniapp-tabs" aria-label="Mini App navigation">{links.map(([href, label]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>)}</nav>
}

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' })
  const [wallet, setWallet] = useState<WalletState>({ status: 'idle' })
  const [readiness, setReadiness] = useState<WalletReadiness>({ status: 'idle' })
  const [showIssuer, setShowIssuer] = useState(false)
  const [verificationId, setVerificationId] = useState('')
  const miniAppAvailable = nimiqPayWallet.isAvailable()
  const miniAppLink = nimiqPayWallet.deepLink()
  const productRoute = /^\/products\/([^/]+)\/?$/.exec(window.location.pathname)
  const passportRoute = /^\/passports\/([^/]+)\/?$/.exec(window.location.pathname)
  const transferRoute = /^\/transfers\/([^/]+)\/?$/.exec(window.location.pathname)
  const presentationRoute = /^\/presentations\/([^/]+)\/?$/.exec(window.location.pathname)
  const issueRoute = window.location.pathname === '/issue'
  const walletRoute = window.location.pathname === '/wallet'
  const howItWorksRoute = window.location.pathname === '/how-it-works'
  const verifyRoute = window.location.pathname === '/verify'

  useEffect(() => {
    applyAppLanguage()
  }, [])

  useEffect(() => {
    if (productRoute?.[1] || passportRoute?.[1] || transferRoute?.[1] || presentationRoute?.[1]) return
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
  }, [passportRoute, presentationRoute, productRoute, transferRoute])

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

  async function checkWalletReadiness() {
    if (!miniAppAvailable) {
      setReadiness({ status: 'error', message: 'Open NimTrace in Nimiq Pay before checking the wallet connection.' })
      return
    }

    setReadiness({ status: 'checking' })
    const connection = await nimiqPayWallet.connect()
    if (connection.status === 'cancelled') {
      setReadiness({ status: 'cancelled' })
      return
    }
    if (connection.status !== 'success') {
      setReadiness({ status: 'error', message: connection.error.message })
      return
    }

    const consensus = await nimiqPayWallet.checkConsensus()
    if (consensus.status === 'success') {
      setReadiness({ status: 'ready', blockNumber: consensus.value.blockNumber })
    } else if (consensus.status === 'cancelled') {
      setReadiness({ status: 'cancelled' })
    } else {
      setReadiness({ status: 'error', message: consensus.error.message })
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

  if (presentationRoute?.[1]) {
    return <MerchantPresentation token={decodeURIComponent(presentationRoute[1])} />
  }

  if (howItWorksRoute) {
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/issue">Issue</a><a href="/wallet">My passports</a></div></nav><section className="route-page"><p className="eyebrow">HOW NIMTRACE WORKS</p><h1>Proof follows the product.</h1><ol><li>An issuer signs the product passport with their Nimiq wallet.</li><li>A buyer pays the issuer directly in NIM from Nimiq Pay.</li><li>NimTrace independently verifies the tagged on-chain payment.</li><li>The buyer receives a portable passport, warranty, and service history.</li><li>The owner can verify, transfer, or present it without exposing private keys.</li></ol><a className="button button--primary" href="/issue">Issue your first product</a></section><MiniAppTabs /></main>
  }

  if (verifyRoute) {
    function openVerification(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const id = verificationId.trim(); if (id) window.location.assign(`/passports/${encodeURIComponent(id)}`) }
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Public verification</span></nav><section className="route-page"><p className="eyebrow">VERIFY WITHOUT A WALLET</p><h1>Check a passport in seconds.</h1><p className="lede">Scan a NimTrace QR code with your phone camera, or paste the passport ID below. You never need to connect a wallet to validate public proof.</p><form className="verify-form" onSubmit={openVerification}><label>Passport ID<input value={verificationId} onChange={(event) => setVerificationId(event.target.value)} placeholder="Paste passport ID" autoComplete="off" required /></label><button className="button button--primary">Verify passport</button></form><p className="foundation-note">Camera QR scanning is coming next. This route already works with every printed or shared passport ID.</p></section><MiniAppTabs /></main>
  }

  if (issueRoute || walletRoute) {
    const title = issueRoute ? 'Issue a signed product passport.' : 'Open your product passports.'
    const detail = issueRoute ? 'Create a real product record, sign it in Nimiq Pay, then share its purchase page.' : 'See passports owned by this wallet, verify warranty status, and transfer products safely.'
    const action = issueRoute ? issueProduct : viewPassports
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/how-it-works">How it works</a><a href={issueRoute ? "/wallet" : "/issue"}>{issueRoute ? 'My passports' : 'Issue'}</a></div></nav>{wallet.status === 'connected' && issueRoute ? <ProductIssuance sessionToken={wallet.sessionToken} onClose={() => { window.location.href = '/' }} /> : wallet.status === 'connected' ? <PassportCollection address={wallet.address} sessionToken={wallet.sessionToken} onBack={() => { window.location.href = '/' }} /> : <section className="route-page"><p className="eyebrow">NIMIQ PAY REQUIRED</p><h1>{title}</h1><p className="lede">{detail}</p>{!miniAppAvailable ? <a className="button button--primary" href={miniAppLink}>Open in Nimiq Pay</a> : <button className="button button--primary" type="button" onClick={() => void action()}>{issueRoute ? 'Connect and issue' : 'Connect my wallet'}</button>}{wallet.status === 'error' && <p className="wallet-notice wallet-notice--error" role="alert">{wallet.message}</p>}</section>}<MiniAppTabs /></main>
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
          <img className="brand-logo" src="/nimtrace-logo-v1.png" alt="" />
          NimTrace
        </a>
        <div className="nav-links"><a href="/how-it-works">How it works</a><a href="/issue">Issue</a><a href="/wallet">My passports</a></div>
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
            {!miniAppAvailable && (
              <a className="button button--primary" href={miniAppLink}>
                Open in Nimiq Pay
              </a>
            )}
            <button
              className="button button--secondary"
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
            {miniAppAvailable && (
              <button
                className="button button--secondary"
                type="button"
                disabled={readiness.status === 'checking'}
                onClick={() => void checkWalletReadiness()}
              >
                {readiness.status === 'checking' ? 'Checking wallet…' : 'Check wallet connection'}
              </button>
            )}
          </div>
          {wallet.status === 'outside' && (
            <p className="wallet-notice" role="status">
              NimTrace needs Nimiq Pay for wallet actions.{' '}
              <a href={wallet.deepLink}>Open NimTrace in Nimiq Pay</a> to issue products, pay in NIM, and manage passports.
            </p>
          )}
          {!miniAppAvailable && (
            <p className="wallet-notice" role="status">If this button does not open Nimiq Pay, open Mini Apps in Nimiq Pay, choose <strong>Custom URL</strong>, and paste <code>https://nimtrace.vercel.app</code>.</p>
          )}
          {miniAppAvailable && wallet.status === 'idle' && (
            <p className="wallet-notice wallet-notice--ready" role="status">
              Nimiq Pay detected. Connect your wallet to issue a product or see your passports.
            </p>
          )}
          {readiness.status === 'ready' && (
            <p className="wallet-notice wallet-notice--ready" role="status">
              Wallet connection ready · consensus at block {readiness.blockNumber}. Your address stays private until you choose a NimTrace action.
            </p>
          )}
          {readiness.status === 'cancelled' && (
            <p className="wallet-notice" role="status">Wallet check cancelled. No message was signed and no payment was requested.</p>
          )}
          {readiness.status === 'error' && (
            <p className="wallet-notice wallet-notice--error" role="alert">{readiness.message}</p>
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
          <p className="foundation-note">Public verification needs no wallet. Issuing, buying, and transfers always require explicit Nimiq Pay approval.</p>
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
      <MiniAppTabs />
    </main>
  )
}
