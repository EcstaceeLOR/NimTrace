import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import { HealthResponseSchema, type HealthResponse, type WalletSessionResponse } from '@nimtrace/contracts'
import { authenticateWallet } from './lib/nimiq/auth'
import { nimiqPayWallet } from './lib/nimiq/wallet'
import { ProductIssuance } from './features/issuer/ProductIssuance'
import { MerchantCommandCenter } from './features/issuer/MerchantCommandCenter'
import { PublicProductPage } from './features/products/PublicProductPage'
import { ProductCatalogue } from './features/products/ProductCatalogue'
import { PassportCollection } from './features/passports/PassportCollection'
import { PublicPassportVerification } from './features/passports/PublicPassportVerification'
import { TransferAcceptance } from './features/passports/TransferAcceptance'
import { MerchantPresentation } from './features/passports/MerchantPresentation'
import { RepairAcceptance } from './features/passports/RepairAcceptance'
import { applyAppLanguage } from './lib/i18n'
import { MiniAppTabs } from './components/MiniAppTabs'

type ApiState =
  | { status: 'checking'; health?: HealthResponse }
  | { status: 'online'; health: HealthResponse }
  | { status: 'offline'; health?: HealthResponse }

type WalletState =
  | { status: 'idle' }
  | { status: 'authenticating' }
  | { status: 'connected'; address: string; sessionToken: string; expiresAt: string }
  | { status: 'cancelled' }
  | { status: 'outside'; deepLink: string }
  | { status: 'error'; message: string }

type WalletReadiness =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ready'; blockNumber: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

const WALLET_SESSION_KEY = 'nimtrace.walletSession'

function readWalletSession(): WalletState {
  if (typeof window === 'undefined') return { status: 'idle' }
  try {
    const raw = window.sessionStorage.getItem(WALLET_SESSION_KEY)
    if (!raw) return { status: 'idle' }
    const session = JSON.parse(raw) as Partial<WalletSessionResponse>
    if (!session.walletAddress || !session.sessionToken || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      window.sessionStorage.removeItem(WALLET_SESSION_KEY)
      return { status: 'idle' }
    }
    return {
      status: 'connected',
      address: session.walletAddress,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    }
  } catch {
    window.sessionStorage.removeItem(WALLET_SESSION_KEY)
    return { status: 'idle' }
  }
}

function saveWalletSession(session: WalletSessionResponse) {
  window.sessionStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session))
}

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' })
  const [wallet, setWallet] = useState<WalletState>(() => readWalletSession())
  const [readiness, setReadiness] = useState<WalletReadiness>({ status: 'idle' })
  const [showIssuer, setShowIssuer] = useState(false)
  const [verificationId, setVerificationId] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [scanState, setScanState] = useState<'idle' | 'reading'>('idle')
  const [verificationState, setVerificationState] = useState<'idle' | 'resolving'>('idle')
  const miniAppAvailable = nimiqPayWallet.isAvailable()
  const miniAppLink = nimiqPayWallet.deepLink()
  const productRoute = /^\/products\/([^/]+)\/?$/.exec(window.location.pathname)
  const passportRoute = /^\/passports\/([^/]+)\/?$/.exec(window.location.pathname)
  const transferRoute = /^\/transfers\/([^/]+)\/?$/.exec(window.location.pathname)
  const presentationRoute = /^\/presentations\/([^/]+)\/?$/.exec(window.location.pathname)
  const repairRoute = /^\/repairs\/([^/]+)\/?$/.exec(window.location.pathname)
  const issueRoute = window.location.pathname === '/issue'
  const walletRoute = window.location.pathname === '/wallet'
  const merchantRoute = window.location.pathname === '/merchant'
  const howItWorksRoute = window.location.pathname === '/how-it-works'
  const verifyRoute = window.location.pathname === '/verify'
  const catalogueRoute = window.location.pathname === '/catalogue'

  useEffect(() => {
    applyAppLanguage()
  }, [])

  useEffect(() => {
    if (productRoute?.[1] || passportRoute?.[1] || transferRoute?.[1] || presentationRoute?.[1] || repairRoute?.[1]) return
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
  }, [passportRoute, presentationRoute, productRoute, repairRoute, transferRoute])

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
        expiresAt: outcome.session.expiresAt,
      })
      saveWalletSession(outcome.session)
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
        expiresAt: outcome.session.expiresAt,
      })
      saveWalletSession(outcome.session)
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

  function disconnectWallet() {
    window.sessionStorage.removeItem(WALLET_SESSION_KEY)
    setWallet({ status: 'idle' })
    setShowIssuer(false)
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

  if (repairRoute?.[1]) {
    return <RepairAcceptance repairId={decodeURIComponent(repairRoute[1])} />
  }

  if (howItWorksRoute) {
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/issue">Issue</a><a href="/wallet">My passports</a></div></nav><section className="route-page"><p className="eyebrow">HOW NIMTRACE WORKS</p><h1>Proof follows the product.</h1><ol><li>An issuer signs the product passport with their Nimiq wallet.</li><li>A buyer pays the issuer directly in NIM from Nimiq Pay.</li><li>NimTrace independently verifies the tagged on-chain payment.</li><li>The buyer receives a portable passport, warranty, and service history.</li><li>The owner can verify, transfer, or present it without exposing private keys.</li></ol><div className="demo-harness"><p className="eyebrow">SAFE REAL-DEVICE CHECK</p><h2>{api.health?.network === 'test-albatross' ? 'Testnet mode active' : 'Mainnet mode active'}</h2><p>{api.health?.network === 'test-albatross' ? 'Use test NIM and two test wallets for the full issue → pay → verify → transfer walkthrough.' : 'This deployment is configured for mainnet. Do not send funds while validating the demo; switch the API to test-albatross for a safe rehearsal.'}</p><ol><li>Open NimTrace in Nimiq Pay using Custom URL.</li><li>Check wallet connection and consensus on the home page.</li><li>Use one wallet to issue, a second wallet to pay, then open the public passport without a wallet.</li><li>Capture the QR or upload it on Verify, then test transfer only with test funds.</li></ol></div><a className="button button--primary" href="/issue">Issue your first product</a></section><MiniAppTabs /></main>
  }

  if (catalogueRoute) {
    return <ProductCatalogue />
  }

  if (verifyRoute) {
    async function openVerification(event: FormEvent<HTMLFormElement>) {
      event.preventDefault()
      const id = verificationId.trim()
      if (!id) return
      setVerificationState('resolving')
      setScanMessage('Looking up product and passport proof…')
      try {
        const passportResponse = await fetch(`/api/passports/${encodeURIComponent(id)}/verification`)
        if (passportResponse.ok) {
          window.location.assign(`/passports/${encodeURIComponent(id)}`)
          return
        }
        const productResponse = await fetch(`/api/products/${encodeURIComponent(id)}`)
        if (productResponse.ok) {
          setScanMessage('Product listing found. Opening its signed proof…')
          window.location.assign(`/products/${encodeURIComponent(id)}`)
          return
        }
        throw new Error('No product or passport was found for that ID. Use the Product ID from issuance, or the Passport ID shown after a confirmed purchase.')
      } catch (error) {
        setVerificationState('idle')
        setScanMessage(error instanceof Error ? error.message : 'The product or passport could not be found.')
      }
    }
    async function scanQrImage(event: ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0]
      if (!file) return
      setScanState('reading')
      setScanMessage('Reading QR…')
      const detectorConstructor = (window as typeof window & { BarcodeDetector?: new (options: { formats: string[] }) => { detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector
      if (!detectorConstructor) { setScanState('idle'); setScanMessage('This device cannot decode QR images here. Paste the passport ID below.'); return }
      try {
        const bitmap = await createImageBitmap(file)
        try {
          const result = await new detectorConstructor({ formats: ['qr_code'] }).detect(bitmap)
          const rawValue = result[0]?.rawValue
          if (!rawValue) throw new Error('No QR code was found in that image.')
          const url = new URL(rawValue, window.location.origin)
          const passportMatch = /^\/passports\/([^/]+)\/?$/.exec(url.pathname)
          const productMatch = /^\/products\/([^/]+)\/?$/.exec(url.pathname)
          const allowedHost = url.hostname === window.location.hostname || url.hostname === 'nimtrace.vercel.app'
          if (!allowedHost || url.search || url.hash || (!passportMatch && !productMatch)) throw new Error('That QR is not a NimTrace product or passport link.')
          const target = passportMatch ? `/passports/${encodeURIComponent(decodeURIComponent(passportMatch[1]!))}` : `/products/${encodeURIComponent(decodeURIComponent(productMatch![1]!))}`
          setVerificationId(decodeURIComponent((passportMatch ?? productMatch)![1]!))
          setScanMessage('NimTrace QR read. Opening signed proof…')
          window.location.assign(target)
        } finally { bitmap.close() }
      } catch (error) { setScanState('idle'); setScanMessage(error instanceof Error ? error.message : 'The QR image could not be read.') }
    }
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Public verification</span></nav><section className="route-page"><p className="eyebrow">VERIFY WITHOUT A WALLET</p><h1>Check a product or passport.</h1><p className="lede">Use a Product ID for an issued listing, or a Passport ID after a confirmed NIM purchase. Take a QR photo, upload a QR screenshot, or paste either ID below.</p><div className="verify-upload"><label className={`button button--secondary${scanState === 'reading' ? ' is-disabled' : ''}`}>Take QR photo<input type="file" accept="image/*" capture="environment" disabled={scanState === 'reading'} onChange={(event) => void scanQrImage(event)} /></label><label className={`button button--secondary${scanState === 'reading' ? ' is-disabled' : ''}`}>Upload QR image<input type="file" accept="image/*" disabled={scanState === 'reading'} onChange={(event) => void scanQrImage(event)} /></label><span>or enter an ID manually</span></div><form className="verify-form" onSubmit={(event) => void openVerification(event)}><label>Product or Passport ID<input value={verificationId} onChange={(event) => setVerificationId(event.target.value)} placeholder="Paste Product ID or Passport ID" autoComplete="off" required /></label><button className="button button--primary" disabled={verificationState === 'resolving'}>{verificationState === 'resolving' ? 'Looking up…' : 'Open signed proof'}</button></form>{scanMessage && <p className="foundation-note" role="status">{scanMessage}</p>}</section><MiniAppTabs /></main>
  }

  if (issueRoute || walletRoute || merchantRoute) {
    const title = issueRoute ? 'Issue a signed product passport.' : merchantRoute ? 'Run your product catalogue.' : 'Open your product passports.'
    const detail = issueRoute ? 'Create a real product record, sign it in Nimiq Pay, then share its purchase page.' : merchantRoute ? 'See live product state, purchaser status, warranty terms, and shareable proof.' : 'See passports owned by this wallet, verify warranty status, and transfer products safely.'
    const action = issueRoute || merchantRoute ? issueProduct : viewPassports
    return <main><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><div className="nav-links"><a href="/how-it-works">How it works</a><a href={issueRoute ? "/wallet" : merchantRoute ? "/issue" : "/merchant"}>{issueRoute ? 'My passports' : merchantRoute ? 'Issue' : 'Merchant studio'}</a></div></nav>{wallet.status === 'connected' && issueRoute ? <ProductIssuance sessionToken={wallet.sessionToken} onClose={() => { window.location.href = '/' }} /> : wallet.status === 'connected' && merchantRoute ? <MerchantCommandCenter sessionToken={wallet.sessionToken} onBack={() => { window.location.href = '/' }} /> : wallet.status === 'connected' ? <PassportCollection address={wallet.address} sessionToken={wallet.sessionToken} onBack={() => { window.location.href = '/' }} /> : <section className="route-page"><p className="eyebrow">NIMIQ PAY REQUIRED</p><h1>{title}</h1><p className="lede">{detail}</p>{!miniAppAvailable ? <a className="button button--primary" href={miniAppLink}>Open in Nimiq Pay</a> : <button className="button button--primary" type="button" onClick={() => void action()}>{issueRoute ? 'Connect and issue' : merchantRoute ? 'Connect merchant wallet' : 'Connect my wallet'}</button>}{wallet.status === 'error' && <p className="wallet-notice wallet-notice--error" role="alert">{wallet.message}</p>}</section>}<MiniAppTabs /></main>
  }

  if (wallet.status === 'connected' && !showIssuer) {
    return (
      <main>
        <PassportCollection
          address={wallet.address}
          sessionToken={wallet.sessionToken}
          onBack={disconnectWallet}
        />
        <MiniAppTabs />
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
        <div className="nav-links"><a href="/how-it-works">How it works</a><a href="/issue">Issue</a><a href="/merchant">Merchant studio</a><a href="/wallet">My passports</a></div>
        <span className={`status status--${api.status}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {api.status === 'online' ? `${api.health.network === 'test-albatross' ? 'Testnet' : 'Mainnet'} ready` : api.status === 'offline' ? 'API unavailable' : 'Connecting'}
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
