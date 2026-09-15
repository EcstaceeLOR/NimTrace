import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  PassportCollectionResponseSchema,
  PassportDetailSchema,
  type PassportCollectionResponse,
  type PassportDetail,
  type PassportSummary,
} from '@nimtrace/contracts'

interface PassportCollectionProps {
  address: string
  fetcher?: typeof fetch
  onBack: () => void
  sessionToken: string
}

type CollectionState =
  | { status: 'loading' }
  | { status: 'ready'; collection: PassportCollectionResponse }
  | { status: 'error'; message: string }

type DetailState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'ready'; passport: PassportDetail }
  | { status: 'error'; message: string }

function shortAddress(address: string) {
  const compact = address.replaceAll(' ', '')
  return `${compact.slice(0, 8)}…${compact.slice(-6)}`
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function warrantyLabel(passport: PassportSummary) {
  if (passport.warrantyState === 'none') return 'No timed warranty'
  if (passport.warrantyState === 'expired') return 'Warranty expired'
  if (passport.warrantyDaysRemaining === 1) return '1 day remaining'
  return `${passport.warrantyDaysRemaining} days remaining`
}

function PassportCard({ passport, onOpen }: { passport: PassportSummary; onOpen: () => void }) {
  return (
    <article className={`owned-passport-card owned-passport-card--${passport.status}${passport.recentlyIssued ? ' owned-passport-card--arriving' : ''}`}>
      {passport.recentlyIssued && <span className="passport-arrival">Added to your wallet</span>}
      <img src={passport.imageUrl} alt="" />
      <div className="owned-passport-card__body">
        <div className="owned-passport-card__meta">
          <span className={`passport-trust passport-trust--${passport.auditState}`}>
            {passport.auditState === 'verified' ? '✓ Verified' : passport.auditState === 'degraded' ? 'Check delayed' : 'Proof issue'}
          </span>
          {passport.ownership === 'former' && <span className="passport-former">Formerly owned</span>}
        </div>
        <h2>{passport.productTitle}</h2>
        <p>Issued by <span title={passport.issuerAddress}>{shortAddress(passport.issuerAddress)}</span></p>
        <div className="passport-warranty">
          <strong>{warrantyLabel(passport)}</strong>
          <span>Until {dateLabel(passport.warrantyExpiresAt)}</span>
        </div>
        {passport.status === 'suspended' && <p className="passport-warning">This passport is suspended. Owner actions are unavailable.</p>}
        <button className="button button--secondary" type="button" onClick={onOpen}>Open passport</button>
      </div>
    </article>
  )
}

function PassportDetailView({ passport, onClose }: { passport: PassportDetail; onClose: () => void }) {
  const [qrCode, setQrCode] = useState<string>()

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(passport.publicUrl, {
      color: { dark: '#090b10', light: '#ffffff' },
      errorCorrectionLevel: 'H',
      margin: 4,
      width: 512,
    }).then((value) => { if (active) setQrCode(value) })
    return () => { active = false }
  }, [passport.publicUrl])

  return (
    <section className="passport-detail" aria-labelledby="passport-detail-title">
      <button className="passport-back" type="button" onClick={onClose}>← All passports</button>
      <header className="passport-detail__hero">
        <div>
          <p className="eyebrow">WALLET-OWNED PASSPORT</p>
          <h1 id="passport-detail-title">{passport.productTitle}</h1>
          <p>{passport.description}</p>
          <div className="passport-detail__badges">
            <span className={`passport-trust passport-trust--${passport.auditState}`}>✓ Payment-backed chain</span>
            <span>{passport.ownership === 'current' ? 'Current owner' : 'Historical read-only view'}</span>
          </div>
        </div>
        {qrCode && <img className="passport-detail__qr" src={qrCode} alt="Public passport verification QR code" />}
      </header>

      {passport.ownership === 'former' && (
        <p className="passport-history-notice">You formerly owned this product. Its history remains visible, but owner actions now belong to the current wallet.</p>
      )}
      {passport.status === 'suspended' && (
        <p className="passport-history-notice">This passport is suspended. Its evidence remains readable while actions are disabled.</p>
      )}

      <div className="passport-detail__grid">
        <article className="passport-proof-panel">
          <p className="eyebrow">PURCHASE PROOF</p>
          <dl>
            <div><dt>Transaction</dt><dd>{passport.purchaseTransactionHash}</dd></div>
            <div><dt>Confirmed block</dt><dd>{passport.purchaseBlockHeight}</dd></div>
            <div><dt>Confirmed</dt><dd>{dateLabel(passport.purchaseConfirmedAt)}</dd></div>
            <div><dt>Signed product</dt><dd>v{passport.productVersion} · {passport.productProofHash.slice(0, 14)}…</dd></div>
            <div><dt>Current owner</dt><dd>{passport.currentOwnerAddress}</dd></div>
          </dl>
        </article>
        <article className="passport-proof-panel">
          <p className="eyebrow">WARRANTY</p>
          <h2>{warrantyLabel(passport)}</h2>
          <p>{passport.warrantySummary}</p>
          <p>{dateLabel(passport.warrantyStartedAt)} — {dateLabel(passport.warrantyExpiresAt)}</p>
        </article>
      </div>

      <section className="passport-timeline" aria-labelledby="timeline-title">
        <p className="eyebrow">TAMPER-EVIDENT LIFECYCLE</p>
        <h2 id="timeline-title">Product history</h2>
        <ol>
          {passport.events.map((event) => (
            <li key={event.eventHash}>
              <span>{event.sequence}</span>
              <div><strong>{event.type.replace('_', ' ')}</strong><p>{dateLabel(event.createdAt)} · {shortAddress(event.actorAddress)}</p><code>{event.eventHash.slice(0, 18)}…</code></div>
            </li>
          ))}
        </ol>
      </section>

      {passport.ownerActions.length > 0 && (
        <div className="passport-owner-actions">
          {passport.ownerActions.includes('transfer') && <button className="button button--primary" type="button">Transfer passport</button>}
          {passport.ownerActions.includes('present_warranty') && <button className="button button--secondary" type="button">Present warranty</button>}
        </div>
      )}
    </section>
  )
}

export function PassportCollection({
  address,
  fetcher = fetch,
  onBack,
  sessionToken,
}: PassportCollectionProps) {
  const [includeHistory, setIncludeHistory] = useState(false)
  const [state, setState] = useState<CollectionState>({ status: 'loading' })
  const [detail, setDetail] = useState<DetailState>({ status: 'closed' })

  const loadCollection = useCallback(async (signal?: AbortSignal) => {
    const query = includeHistory ? '?includeHistory=true' : ''
    const response = await fetcher(`/api/passports${query}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
      signal,
    })
    if (!response.ok) throw new Error('Your passport collection is temporarily unavailable.')
    setState({ status: 'ready', collection: PassportCollectionResponseSchema.parse(await response.json()) })
  }, [fetcher, includeHistory, sessionToken])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void loadCollection(controller.signal).catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', message: 'Your passport collection is temporarily unavailable.' })
      })
    }, 0)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [loadCollection])

  async function openPassport(passportId: string) {
    setDetail({ status: 'loading' })
    try {
      const response = await fetcher(`/api/passports/${encodeURIComponent(passportId)}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      if (!response.ok) throw new Error()
      setDetail({ status: 'ready', passport: PassportDetailSchema.parse(await response.json()) })
    } catch {
      setDetail({ status: 'error', message: 'This passport could not be opened. Your ownership state was not changed.' })
    }
  }

  if (detail.status === 'ready') return <PassportDetailView passport={detail.passport} onClose={() => setDetail({ status: 'closed' })} />
  if (detail.status === 'loading') return <section className="passport-collection-state" role="status"><div className="passport-skeleton" /><p>Opening verified passport…</p></section>
  if (detail.status === 'error') return <section className="passport-collection-state" role="alert"><h1>Passport unavailable</h1><p>{detail.message}</p><button className="button button--secondary" onClick={() => setDetail({ status: 'closed' })}>Back to collection</button></section>

  return (
    <section className="passport-collection" aria-labelledby="collection-title">
      <nav className="nav">
        <button className="brand passport-brand-button" type="button" onClick={onBack}><span className="brand-mark">N</span>NimTrace</button>
        <span className="wallet-chip" title={address}>{shortAddress(address)}</span>
      </nav>
      <header className="passport-collection__header">
        <div><p className="eyebrow">YOUR DURABLE OWNERSHIP</p><h1 id="collection-title">My passports</h1><p>Products you own now—verified against payment, issuer proof, and lifecycle history.</p></div>
        <label className="history-toggle"><input type="checkbox" checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)} /> Include former ownership</label>
      </header>

      {state.status === 'loading' && <div className="passport-card-grid" role="status" aria-label="Loading passports"><div className="passport-skeleton" /><div className="passport-skeleton" /></div>}
      {state.status === 'error' && <section className="passport-collection-state" role="alert"><h2>Collection unavailable</h2><p>{state.message}</p><button className="button button--primary" onClick={() => { setState({ status: 'loading' }); void loadCollection().catch(() => setState({ status: 'error', message: 'Your passport collection is temporarily unavailable.' })) }}>Try again</button></section>}
      {state.status === 'ready' && state.collection.items.length === 0 && <section className="passport-collection-state passport-empty"><span>N</span><h2>{includeHistory ? 'No passport history yet' : 'Your first passport will appear here'}</h2><p>A passport enters this wallet only after an independently verified NIM purchase or accepted transfer.</p><button className="button button--secondary" type="button" onClick={onBack}>Explore NimTrace</button></section>}
      {state.status === 'ready' && state.collection.items.length > 0 && <div className="passport-card-grid">{state.collection.items.map((passport) => <PassportCard key={passport.id} passport={passport} onOpen={() => void openPassport(passport.id)} />)}</div>}
    </section>
  )
}
