import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  PublicPassportVerificationSchema,
  type PublicPassportVerification,
} from '@nimtrace/contracts'
import { MiniAppTabs } from '../../components/MiniAppTabs'

interface PublicPassportVerificationProps {
  fetcher?: typeof fetch
  passportId: string
}

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; passport: PublicPassportVerification }
  | { status: 'error' }

const stateCopy = {
  merchant_claim: {
    label: 'Merchant claim only',
    message: 'This information comes from the merchant and is not cryptographically verified.',
  },
  partially_verified: {
    label: 'Partially verified',
    message: 'Stored proofs passed, but live Nimiq network evidence could not be checked right now.',
  },
  unverified: {
    label: 'Verification failed',
    message: 'At least one cryptographic proof is invalid. Do not rely on this passport until resolved.',
  },
  verified: {
    label: 'Verified passport',
    message: 'Issuer proof, purchase transaction, ownership, and lifecycle history all passed.',
  },
} as const

function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function shortHash(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`
}

function safeQrUrl(value: string) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || !/^\/passports\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Unsafe public passport URL')
  }
  return url.toString()
}

function EvidenceState({ state }: { state: 'verified' | 'partial' | 'unverified' | 'claim' }) {
  const label = state === 'verified' ? 'Verified' : state === 'partial' ? 'Check delayed' : state === 'claim' ? 'Claim' : 'Invalid'
  return <span className={`verification-evidence verification-evidence--${state}`}>{label}</span>
}

export function PublicPassportVerification({
  fetcher = fetch,
  passportId,
}: PublicPassportVerificationProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [qrCode, setQrCode] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    void fetcher(`/api/passports/${encodeURIComponent(passportId)}/verification`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Passport unavailable')
      const passport = PublicPassportVerificationSchema.parse(await response.json())
      setState({ status: 'ready', passport })
      return QRCode.toDataURL(safeQrUrl(passport.publicUrl), {
        color: { dark: '#090b10', light: '#ffffff' },
        errorCorrectionLevel: 'H',
        margin: 4,
        width: 512,
      })
    }).then(setQrCode).catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [fetcher, passportId])

  if (state.status === 'loading') {
    return <main className="verification-loading" role="status"><span className="verification-pulse" /><h1>Checking passport proofs…</h1><p>No wallet connection is required.</p></main>
  }
  if (state.status === 'error') {
    return <main className="verification-error" role="alert"><p className="eyebrow">PUBLIC VERIFICATION</p><h1>Passport unavailable</h1><p>This passport does not exist or its evidence could not be loaded.</p><a className="button button--secondary" href="/">Return to NimTrace</a></main>
  }

  const { passport } = state
  const copy = stateCopy[passport.overallState]

  return (
    <main className={`public-verification public-verification--${passport.overallState}`}>
      <nav className="nav verification-nav">
        <a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a>
        <span>Public proof · no wallet needed</span>
      </nav>

      <header className="verification-hero">
        <div>
          <p className="eyebrow">DIGITAL PRODUCT PASSPORT</p>
          <div className="verification-verdict" role="status">
            <span aria-hidden="true">{passport.overallState === 'verified' ? '✓' : passport.overallState === 'unverified' ? '!' : 'i'}</span>
            <div><strong>{copy.label}</strong><p>{copy.message}</p></div>
          </div>
          <h1>{passport.product.title}</h1>
          <p className="verification-id">Passport {passport.id} · Product version {passport.product.version}</p>
          {passport.status === 'suspended' && <p className="verification-suspended">This passport is suspended. Its evidence remains visible, but it must not be transferred or used for warranty service.</p>}
        </div>
        <div className="verification-qr-card">
          {qrCode ? <img src={qrCode} alt="Shareable public passport verification QR code" loading="lazy" decoding="async" /> : <span className="verification-qr-placeholder" />}
          <strong>Scan to verify</strong>
          <button type="button" onClick={() => window.print()}>Print QR</button>
        </div>
      </header>

      <section className="verification-section" aria-labelledby="cryptographic-facts">
        <div className="verification-section__heading">
          <div><p className="eyebrow">INDEPENDENT EVIDENCE</p><h2 id="cryptographic-facts">Cryptographic facts</h2></div>
          <p>Computed from signed records and live Nimiq chain data—not merchant descriptions.</p>
        </div>
        <div className="verification-fact-grid">
          <article>
            <div><h3>Issuer signature</h3><EvidenceState state={passport.product.state} /></div>
            <dl><div><dt>Issuer</dt><dd>{passport.product.issuerAddress}</dd></div><div><dt>Signed product hash</dt><dd title={passport.product.payloadHash}>{shortHash(passport.product.payloadHash)}</dd></div></dl>
          </article>
          <article>
            <div><h3>Purchase transaction</h3><EvidenceState state={passport.purchase.state} /></div>
            <dl><div><dt>Transaction</dt><dd title={passport.purchase.transactionHash}>{shortHash(passport.purchase.transactionHash)}</dd></div><div><dt>Block</dt><dd>{passport.purchase.blockHeight}</dd></div><div><dt>Confirmed</dt><dd>{dateTime(passport.purchase.confirmedAt)}</dd></div></dl>
            {passport.purchase.state === 'partial' && <p className="verification-delay">RPC check delayed: {passport.purchase.reason}. Last attempted {dateTime(passport.checkedAt)}.</p>}
          </article>
          <article>
            <div><h3>Current ownership</h3><EvidenceState state={passport.ownership.state} /></div>
            <dl><div><dt>Masked owner</dt><dd>{passport.ownership.maskedCurrentOwner}</dd></div><div><dt>Passport status</dt><dd>{passport.status.replace('_', ' ')}</dd></div></dl>
          </article>
          <article>
            <div><h3>Warranty dates</h3><EvidenceState state={passport.product.state} /></div>
            <dl><div><dt>Status</dt><dd>{passport.warranty.state}</dd></div><div><dt>Started</dt><dd>{dateTime(passport.warranty.startedAt)}</dd></div><div><dt>Expires</dt><dd>{dateTime(passport.warranty.expiresAt)}</dd></div></dl>
          </article>
        </div>
      </section>

      <section className="verification-section verification-chain" aria-labelledby="event-chain">
        <div className="verification-section__heading">
          <div><p className="eyebrow">TAMPER-EVIDENT</p><h2 id="event-chain">Lifecycle event chain</h2></div>
          <EvidenceState state={passport.eventChain.state} />
        </div>
        <p>{passport.eventChain.eventCount} linked event{passport.eventChain.eventCount === 1 ? '' : 's'} · Head {shortHash(passport.eventChain.headEventHash)}</p>
        <ol>
          {passport.eventChain.events.map((event) => <li key={event.eventHash}><span>{event.sequence}</span><div><strong>{event.type === 'repaired' ? 'Repairer signer attestation' : event.type.replace('_', ' ')}</strong><p>{dateTime(event.createdAt)} · Actor {event.maskedActor}</p>{event.type === 'repaired' && <p className="verification-delay">NimTrace verifies signatures and history only; this is not a physical inspection.</p>}<code>{shortHash(event.eventHash)}</code></div></li>)}
        </ol>
      </section>

      <section className="verification-claims" aria-labelledby="merchant-claims">
        <p className="eyebrow">MERCHANT-PROVIDED · NOT INDEPENDENTLY VERIFIED</p>
        <h2 id="merchant-claims">Merchant claims</h2>
        <p>{passport.merchantClaims.description}</p>
        <h3>Warranty terms</h3>
        <p>{passport.merchantClaims.warrantySummary}</p>
      </section>

      <footer className="verification-footer">Checked {dateTime(passport.checkedAt)} · Refresh this page for a new live chain check.</footer>
      <MiniAppTabs />
    </main>
  )
}
