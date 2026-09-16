import { useState } from 'react'
import {
  PublicPassportVerificationSchema,
  TransferIntentResponseSchema,
  TransferProofChallengeResponseSchema,
  type PublicPassportVerification,
  type TransferIntentResponse,
} from '@nimtrace/contracts'
import { authenticateWallet } from '../../lib/nimiq/auth'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'

export function TransferAcceptance({ fetcher = fetch, intentId }: { fetcher?: typeof fetch; intentId: string }) {
  const [intent, setIntent] = useState<TransferIntentResponse>()
  const [passport, setPassport] = useState<PublicPassportVerification>()
  const [session, setSession] = useState<{ sessionToken: string; walletAddress: string }>()
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'signing' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function connectRecipient() {
    if (!nimiqPayWallet.isAvailable()) {
      setMessage('Open this transfer link inside Nimiq Pay to accept it.')
      setState('error')
      return
    }
    setState('loading')
    try {
      const outcome = await authenticateWallet()
      if (outcome.status !== 'success') throw new Error(outcome.status === 'cancelled' ? 'Wallet connection cancelled.' : outcome.error.message)
      const auth = { sessionToken: outcome.session.sessionToken, walletAddress: outcome.session.walletAddress }
      const response = await fetcher(`/api/transfer-intents/${encodeURIComponent(intentId)}`, { headers: { Authorization: `Bearer ${auth.sessionToken}` } })
      if (!response.ok) throw new Error('This transfer offer is unavailable or is bound to another wallet.')
      const nextIntent = TransferIntentResponseSchema.parse(await response.json())
      const passportResponse = await fetcher(`/api/passports/${encodeURIComponent(nextIntent.passportId)}/verification`)
      if (!passportResponse.ok) throw new Error('The passport proof could not be loaded.')
      setSession(auth)
      setIntent(nextIntent)
      setPassport(PublicPassportVerificationSchema.parse(await passportResponse.json()))
      setState('ready')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The transfer could not be loaded.')
      setState('error')
    }
  }

  async function accept() {
    if (!session || !intent) return
    setState('signing')
    try {
      const challengeResponse = await fetcher(`/api/transfer-intents/${encodeURIComponent(intent.id)}/acceptance-challenges`, { method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}` } })
      if (!challengeResponse.ok) throw new Error('This offer is no longer available.')
      const challenge = TransferProofChallengeResponseSchema.parse(await challengeResponse.json())
      const signed = await nimiqPayWallet.sign(challenge.message)
      if (signed.status !== 'success') throw new Error(signed.status === 'cancelled' ? 'Acceptance cancelled. Ownership did not change.' : signed.error.message)
      const response = await fetcher(`/api/transfer-intents/${encodeURIComponent(intent.id)}/accept`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof: { envelope: challenge.envelope, payload: challenge.payload, ...signed.value } }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null) as { message?: string } | null)?.message ?? 'Acceptance was rejected.')
      const accepted = TransferIntentResponseSchema.parse(await response.json())
      if (accepted.priceLuna > 0) {
        if (!accepted.paymentIntentId || !accepted.transactionData) throw new Error('The resale payment intent is incomplete.')
        setMessage('Acceptance signed. Approve the direct payment to the current owner; NimTrace never holds or reverses it.')
        const payment = await nimiqPayWallet.pay({
          recipient: accepted.fromAddress,
          valueLuna: accepted.priceLuna,
          data: accepted.transactionData,
        })
        if (payment.status !== 'success') throw new Error(payment.status === 'cancelled' ? 'Payment cancelled. Ownership did not change.' : payment.error.message)
        const submission = await fetcher(`/api/payment-intents/${encodeURIComponent(accepted.paymentIntentId)}/submissions`, {
          method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionHash: payment.value.transactionHash }),
        })
        if (!submission.ok) throw new Error('The payment was sent but could not be linked. Keep the transaction hash and retry reconciliation.')
        const completion = await fetcher(`/api/transfer-intents/${encodeURIComponent(accepted.id)}/complete-payment`, {
          method: 'POST', headers: { Authorization: `Bearer ${session.sessionToken}` },
        })
        if (!completion.ok) throw new Error('Payment submitted. Ownership will update after independent network finality.')
      }
      setState('done')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Acceptance failed.')
      setState('error')
    }
  }

  return (
    <main className="transfer-acceptance">
      <nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Recipient-bound gift</span></nav>
      <section className="transfer-acceptance__card">
        <p className="eyebrow">PASSPORT TRANSFER</p>
        <h1>Receive a product passport.</h1>
        {state === 'idle' && <><p>Connect the recipient wallet to review the complete public proof before signing acceptance. No NIM payment is requested.</p><button className="button button--primary" type="button" onClick={() => void connectRecipient()}>Review with Nimiq Pay</button></>}
        {state === 'loading' && <p role="status">Loading the signed offer and passport proof…</p>}
        {passport && intent && state !== 'done' && state !== 'error' && <div className="transfer-review"><h2>{passport.product.title}</h2><p>{passport.overallState === 'verified' ? 'Verified passport' : 'Review required'} · Current owner {passport.ownership.maskedCurrentOwner}</p><dl><div><dt>Recipient wallet</dt><dd>{intent.toAddress}</dd></div><div><dt>Warranty</dt><dd>{passport.warranty.state} until {new Date(passport.warranty.expiresAt).toLocaleDateString()}</dd></div><div><dt>Events</dt><dd>{passport.eventChain.eventCount} linked</dd></div></dl><button className="button button--primary" type="button" onClick={() => void accept()}>Sign acceptance</button></div>}
        {state === 'signing' && <p role="status">Waiting for recipient signature…</p>}
        {state === 'done' && <div className="transfer-success"><h2>Passport received</h2><p>Ownership changed atomically. The former owner no longer has owner actions.</p><a className="button button--secondary" href="/">Back to NimTrace</a></div>}
        {state === 'error' && <div className="transfer-error" role="alert"><p>{message}</p><button className="button button--secondary" type="button" onClick={() => setState('idle')}>Try again</button></div>}
      </section>
    </main>
  )
}
