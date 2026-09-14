import { useState, type FormEvent } from 'react'
import {
  ProductIssuanceChallengeResponseSchema,
  PublishedProductResponseSchema,
  type ProductIssuanceChallengeResponse,
} from '@nimtrace/contracts'
import { formatNimFromLuna, nimToLuna } from '../../lib/formatting/nim'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'

interface ProductIssuanceProps {
  onClose(): void
  sessionToken: string
}

type IssuanceState =
  | { status: 'draft'; message?: string }
  | { status: 'preparing' }
  | { status: 'review'; challenge: ProductIssuanceChallengeResponse }
  | { status: 'signing'; challenge: ProductIssuanceChallengeResponse }
  | { status: 'published'; id: string }
  | { status: 'failed'; message: string }

async function fileHash(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function errorMessage(response: Response) {
  const value = await response.json().catch(() => null) as { message?: unknown } | null
  return typeof value?.message === 'string' ? value.message : 'The product could not be issued.'
}

export function ProductIssuance({ onClose, sessionToken }: ProductIssuanceProps) {
  const [state, setState] = useState<IssuanceState>({ status: 'draft' })

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'preparing' })
    const form = new FormData(event.currentTarget)

    try {
      const image = form.get('image')
      if (!(image instanceof File) || image.size === 0) throw new Error('Choose one product image.')
      const imageHash = await fileHash(image)
      const priceLuna = nimToLuna(String(form.get('priceNim') ?? ''))
      const response = await fetch('/api/products/issuance-challenges', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: String(form.get('description') ?? ''),
          imageHash,
          imageKey: `pending/${imageHash}`,
          priceLuna,
          serialReference: String(form.get('serialReference') ?? ''),
          title: String(form.get('title') ?? ''),
          warrantyDurationDays: Number(form.get('warrantyDurationDays')),
          warrantySummary: String(form.get('warrantySummary') ?? ''),
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      setState({
        status: 'review',
        challenge: ProductIssuanceChallengeResponseSchema.parse(await response.json()),
      })
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Could not prepare product.' })
    }
  }

  async function publish(challenge: ProductIssuanceChallengeResponse) {
    setState({ status: 'signing', challenge })
    const signed = await nimiqPayWallet.sign(challenge.message)
    if (signed.status === 'cancelled') {
      setState({ status: 'review', challenge })
      return
    }
    if (signed.status === 'error') {
      setState({ status: 'failed', message: signed.error.message })
      return
    }

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proof: {
            envelope: challenge.envelope,
            payload: challenge.payload,
            publicKey: signed.value.publicKey,
            signature: signed.value.signature,
          },
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      const product = PublishedProductResponseSchema.parse(await response.json())
      setState({ status: 'published', id: product.id })
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Publishing failed.' })
    }
  }

  return (
    <section className="issuer-panel" aria-labelledby="issuer-title">
      <div className="issuer-heading">
        <div><p className="eyebrow">MERCHANT STUDIO</p><h2 id="issuer-title">Issue a product</h2></div>
        <button className="issuer-close" type="button" onClick={onClose} aria-label="Close product issuer">×</button>
      </div>

      {(state.status === 'draft' || state.status === 'preparing' || state.status === 'failed') && (
        <form className="issuer-form" onSubmit={(event) => void prepare(event)}>
          <p className="issuer-state issuer-wide">Draft</p>
          <label>Product title<input name="title" required maxLength={120} /></label>
          <label>Serial or merchant reference<input name="serialReference" required maxLength={120} /></label>
          <label>Product image<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
          <label>Price in NIM<input name="priceNim" inputMode="decimal" placeholder="1.00" required /></label>
          <label>Warranty duration in days<input name="warrantyDurationDays" type="number" min="0" max="36500" required /></label>
          <label className="issuer-wide">Warranty summary<textarea name="warrantySummary" required maxLength={1000} /></label>
          <label className="issuer-wide">Description<textarea name="description" maxLength={4000} /></label>
          {state.status === 'failed' && <p className="issuer-error issuer-wide" role="alert">{state.message}</p>}
          <p className="issuer-help issuer-wide">Your wallet signature proves who issued this product. It is not legal verification by NimTrace or Nimiq.</p>
          <button className="button button--primary issuer-wide" disabled={state.status === 'preparing'}>
            {state.status === 'preparing' ? 'Preparing review…' : 'Review product'}
          </button>
        </form>
      )}

      {(state.status === 'review' || state.status === 'signing') && (
        <div className="issuer-review">
          <p className="issuer-state">Ready for wallet signature</p>
          <h3>{state.challenge.payload.title}</h3>
          <dl>
            <div><dt>Price</dt><dd>{formatNimFromLuna(state.challenge.payload.priceLuna)}</dd></div>
            <div><dt>Warranty</dt><dd>{state.challenge.payload.warrantyDurationDays} days</dd></div>
            <div><dt>Serial fingerprint</dt><dd>{state.challenge.payload.serialNumberHash.slice(0, 12)}…</dd></div>
          </dl>
          <p>{state.challenge.payload.warrantySummary}</p>
          <p className="issuer-sign-summary">Nimiq Pay will show: “{state.challenge.envelope.summary}”</p>
          <button
            className="button button--primary"
            disabled={state.status === 'signing'}
            onClick={() => void publish(state.challenge)}
          >
            {state.status === 'signing' ? 'Waiting for signature…' : 'Sign and publish'}
          </button>
          <button className="button button--secondary" type="button" onClick={() => setState({ status: 'draft' })}>Edit draft</button>
        </div>
      )}

      {state.status === 'published' && (
        <div className="issuer-success" role="status">
          <p className="issuer-state">Published</p>
          <h3>Signed product issued.</h3>
          <p>Product ID: <code>{state.id}</code></p>
          <button className="button button--primary" type="button" onClick={onClose}>Done</button>
        </div>
      )}
    </section>
  )
}
