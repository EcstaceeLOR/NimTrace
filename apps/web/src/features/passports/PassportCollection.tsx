import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  PassportCollectionResponseSchema,
  PassportDetailSchema,
  TransferIntentResponseSchema,
  TransferProofChallengeResponseSchema,
  WarrantyPresentationResponseSchema,
  type PassportCollectionResponse,
  type PassportDetail,
  type PassportSummary,
} from '@nimtrace/contracts'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'

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

function eventLabel(type: PassportDetail['events'][number]['type']) {
  if (type === 'issued') return 'Passport issued'
  if (type === 'transferred') return 'Ownership transferred'
  if (type === 'repaired') return 'Signed repair acknowledged'
  if (type === 'warranty_claimed') return 'Warranty claim recorded'
  if (type === 'corrected') return 'Record corrected'
  return 'Passport retired'
}

function PassportCard({ passport, onOpen }: { passport: PassportSummary; onOpen: () => void }) {
  return (
    <article className={`owned-passport-card owned-passport-card--${passport.status}${passport.recentlyIssued ? ' owned-passport-card--arriving' : ''}`}>
      {passport.recentlyIssued && <span className="passport-arrival">Added to your wallet</span>}
      <img src={passport.imageUrl} alt="" loading="lazy" decoding="async" />
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

function PassportDetailView({ passport, fetcher, onClose, sessionToken }: { fetcher: typeof fetch; passport: PassportDetail; onClose: () => void; sessionToken: string }) {
  const [qrCode, setQrCode] = useState<string>()
  const [recipient, setRecipient] = useState('')
  const [priceLuna, setPriceLuna] = useState('0')
  const [transferState, setTransferState] = useState<'closed' | 'form' | 'signing' | 'success' | 'error'>('closed')
  const [transferMessage, setTransferMessage] = useState('')
  const [transferId, setTransferId] = useState('')
  const [presentation, setPresentation] = useState<{ url: string; expiresAt: string }>()

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

  async function createTransferOffer() {
    setTransferState('signing')
    try {
      const challengeResponse = await fetcher(`/api/passports/${encodeURIComponent(passport.id)}/transfer-intents`, {
        method: 'POST', headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceLuna: Math.max(0, Number(priceLuna) || 0), recipientAddress: recipient }),
      })
      if (!challengeResponse.ok) throw new Error('The transfer offer could not be prepared.')
      const challenge = TransferProofChallengeResponseSchema.parse(await challengeResponse.json())
      const signed = await nimiqPayWallet.sign(challenge.message)
      if (signed.status !== 'success') throw new Error(signed.status === 'cancelled' ? 'Signature cancelled. Nothing changed.' : signed.error.message)
      const offerResponse = await fetcher(`/api/passports/${encodeURIComponent(passport.id)}/transfer-intents/${encodeURIComponent(challenge.intentId)}/offer`, {
        method: 'POST', headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof: { envelope: challenge.envelope, payload: challenge.payload, ...signed.value } }),
      })
      if (!offerResponse.ok) throw new Error((await offerResponse.json().catch(() => null) as { message?: string } | null)?.message ?? 'The transfer offer was rejected.')
      const intent = TransferIntentResponseSchema.parse(await offerResponse.json())
      setTransferId(intent.id)
      setTransferState('success')
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'The transfer offer failed.')
      setTransferState('error')
    }
  }

  async function createPresentation() {
    try {
      const response = await fetcher(`/api/passports/${encodeURIComponent(passport.id)}/presentations`, {
        method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` },
      })
      if (!response.ok) throw new Error('The presentation could not be created.')
      const value = WarrantyPresentationResponseSchema.parse(await response.json())
      setPresentation(value)
      const qr = await QRCode.toDataURL(value.url, { color: { dark: '#090b10', light: '#ffffff' }, errorCorrectionLevel: 'H', margin: 4, width: 512 })
      setQrCode(qr)
    } catch (error) {
      setTransferMessage(error instanceof Error ? error.message : 'The presentation could not be created.')
      setTransferState('error')
    }
  }

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
        {qrCode && <img className="passport-detail__qr" src={qrCode} alt="Public passport verification QR code" loading="lazy" decoding="async" />}
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
        <div className="passport-milestones">
          <article><span>Payment verified</span><strong>Block {passport.purchaseBlockHeight}</strong><small>{dateLabel(passport.purchaseConfirmedAt)}</small></article>
          <article><span>Warranty</span><strong>{warrantyLabel(passport)}</strong><small>{dateLabel(passport.warrantyStartedAt)} — {dateLabel(passport.warrantyExpiresAt)}</small></article>
          <article><span>Current owner</span><strong>{passport.ownership === 'current' ? 'This wallet' : 'Former owner'}</strong><small>{passport.status.replace('_', ' ')}</small></article>
        </div>
        <ol>
          {passport.events.map((event) => (
            <li key={event.eventHash}>
              <span>{event.sequence}</span>
              <div><strong>{eventLabel(event.type)}</strong><p>{dateLabel(event.createdAt)} · {shortAddress(event.actorAddress)}</p><code>{event.eventHash.slice(0, 18)}…</code></div>
            </li>
          ))}
        </ol>
      </section>

      {passport.ownerActions.length > 0 && (
        <div className="passport-owner-actions">
          {passport.ownerActions.includes('transfer') && <button className="button button--primary" type="button" onClick={() => setTransferState('form')}>Transfer passport</button>}
          {passport.ownerActions.includes('present_warranty') && <button className="button button--secondary" type="button" onClick={() => void createPresentation()}>Present warranty</button>}
        </div>
      )}
      {transferState === 'form' && (
        <div className="transfer-panel" role="dialog" aria-labelledby="transfer-title">
          <p className="eyebrow">RECIPIENT-BOUND GIFT</p><h2 id="transfer-title">Gift this passport</h2>
          <p>The recipient wallet will need to review the complete passport and sign acceptance. No NIM moves.</p>
          <label>Recipient wallet address<input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="NQ…" autoComplete="off" /></label>
          <label>Resale price in Luna (0 = gift)<input inputMode="numeric" min="0" step="1" type="number" value={priceLuna} onChange={(event) => setPriceLuna(event.target.value)} /></label>
          <div className="passport-owner-actions"><button className="button button--primary" type="button" disabled={!recipient.trim()} onClick={() => void createTransferOffer()}>Review and sign offer</button><button className="button button--secondary" type="button" onClick={() => setTransferState('closed')}>Cancel</button></div>
        </div>
      )}
      {transferState === 'signing' && <p className="passport-history-notice" role="status">Waiting for your wallet signature…</p>}
      {transferState === 'error' && <p className="passport-history-notice" role="alert">{transferMessage}</p>}
      {transferState === 'success' && <p className="transfer-success" role="status">Gift offer created. Share transfer ID <code>{transferId}</code> with the recipient wallet; it expires with the signed offer.</p>}
      {presentation && <div className="presentation-panel" role="status"><p className="eyebrow">SHORT-LIVED MERCHANT PRESENTATION</p><h2>Show this QR at service</h2><p>This is a read-only evidence presentation, not a warranty claim, legal entitlement, or acceptance of service.</p>{qrCode && <img src={qrCode} alt="Short-lived merchant warranty presentation QR code" />}<small>Expires {dateLabel(presentation.expiresAt)}</small></div>}
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

  if (detail.status === 'ready') return <PassportDetailView fetcher={fetcher} passport={detail.passport} sessionToken={sessionToken} onClose={() => setDetail({ status: 'closed' })} />
  if (detail.status === 'loading') return <section className="passport-collection-state" role="status"><div className="passport-skeleton" /><p>Opening verified passport…</p></section>
  if (detail.status === 'error') return <section className="passport-collection-state" role="alert"><h1>Passport unavailable</h1><p>{detail.message}</p><button className="button button--secondary" onClick={() => setDetail({ status: 'closed' })}>Back to collection</button></section>

  return (
    <section className="passport-collection" aria-labelledby="collection-title">
      <nav className="nav">
        <button className="brand passport-brand-button" type="button" onClick={onBack}><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</button>
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
