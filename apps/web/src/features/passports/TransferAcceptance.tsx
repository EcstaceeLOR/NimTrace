import { useState } from 'react'
import {
  PaymentVerificationResponseSchema,
  PublicPassportVerificationSchema,
  TransferIntentResponseSchema,
  TransferProofChallengeResponseSchema,
  type PublicPassportVerification,
  type TransferIntentResponse,
} from '@nimtrace/contracts'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { authenticateWallet } from '../../lib/nimiq/auth'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'
import { MiniAppTabs } from '../../components/MiniAppTabs'

type TransferStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

type RecoveryStage = 'accepted' | 'payment_requested' | 'hash_captured' | 'submitted'

interface PersistedTransfer {
  intent: TransferIntentResponse
  recipientAddress: string
  stage: RecoveryStage
  transactionHash?: string
}

interface TransferAcceptanceProps {
  fetcher?: typeof fetch
  intentId: string
  storage?: TransferStorage
}

function browserStorage(): TransferStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function recoveryKey(intentId: string) {
  return `nimtrace:transfer:${intentId}`
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function restoreTransfer(storage: TransferStorage | undefined, intentId: string): PersistedTransfer | undefined {
  try {
    const raw = storage?.getItem(recoveryKey(intentId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const intent = TransferIntentResponseSchema.safeParse(parsed.intent)
    const stage = parsed.stage
    if (!intent.success || intent.data.id !== intentId || !['accepted', 'payment_requested', 'hash_captured', 'submitted'].includes(String(stage))) return undefined
    if (typeof parsed.recipientAddress !== 'string' || parsed.recipientAddress !== intent.data.toAddress) return undefined
    if ((stage === 'hash_captured' || stage === 'submitted') && !validHash(parsed.transactionHash)) return undefined
    return {
      intent: intent.data,
      recipientAddress: parsed.recipientAddress,
      stage: stage as RecoveryStage,
      ...(validHash(parsed.transactionHash) ? { transactionHash: parsed.transactionHash } : {}),
    }
  } catch {
    return undefined
  }
}

export function TransferAcceptance({ fetcher = fetch, intentId, storage = browserStorage() }: TransferAcceptanceProps) {
  const restored = restoreTransfer(storage, intentId)
  const [intent, setIntent] = useState<TransferIntentResponse>(restored?.intent)
  const [passport, setPassport] = useState<PublicPassportVerification>()
  const [session, setSession] = useState<{ sessionToken: string; walletAddress: string }>()
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'signing' | 'recovering' | 'done' | 'error'>(restored ? 'recovering' : 'idle')
  const [message, setMessage] = useState(restored ? 'An unfinished paid transfer is saved on this device. Resume it without paying again.' : '')

  function persist(record: PersistedTransfer) {
    try {
      storage?.setItem(recoveryKey(intentId), JSON.stringify(record))
    } catch {
      // In-memory flow continues safely if storage is unavailable.
    }
  }

  function clearPersisted() {
    try {
      storage?.removeItem(recoveryKey(intentId))
    } catch {
      // Nothing else is required.
    }
  }

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

  async function submitAndComplete(record: PersistedTransfer, sessionToken: string) {
    if (!record.intent.paymentIntentId || !record.transactionHash) throw new Error('The saved transfer is missing its payment reference.')
    let current = record
    if (record.stage === 'hash_captured') {
      const submission = await fetcher(`/api/payment-intents/${encodeURIComponent(record.intent.paymentIntentId)}/submissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionHash: record.transactionHash }),
      })
      if (!submission.ok) throw new Error('The saved payment hash could not be linked yet. Do not pay again; retry recovery.')
      current = { ...record, stage: 'submitted' }
      persist(current)
    }

    const completion = await fetcher(`/api/transfer-intents/${encodeURIComponent(current.intent.id)}/complete-payment`, {
      method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` },
    })
    if (!completion.ok) throw new Error('Payment is saved. Ownership is waiting for network finality; retry recovery instead of paying again.')
    clearPersisted()
    setState('done')
  }

  async function requestPayment(accepted: TransferIntentResponse, sessionToken: string) {
    if (!accepted.paymentIntentId || !accepted.transactionData) throw new Error('The resale payment intent is incomplete.')
    const beforePayment: PersistedTransfer = {
      intent: accepted,
      recipientAddress: accepted.toAddress,
      stage: 'payment_requested',
    }
    persist(beforePayment)
    setMessage('Acceptance signed. Approve the direct payment to the current owner; NimTrace never holds or reverses it.')
    const payment = await nimiqPayWallet.pay({
      recipient: accepted.fromAddress,
      valueLuna: accepted.priceLuna,
      data: accepted.transactionData,
    })
    if (payment.status !== 'success') {
      if (payment.status === 'cancelled') {
        persist({ ...beforePayment, stage: 'accepted' })
        throw new Error('Payment cancelled. Nothing was paid; you can resume this accepted transfer later.')
      }
      throw new Error(`${payment.error.message} The transfer is saved; use recovery before attempting any new payment.`)
    }

    const captured: PersistedTransfer = {
      intent: accepted,
      recipientAddress: accepted.toAddress,
      stage: 'hash_captured',
      transactionHash: payment.value.transactionHash,
    }
    persist(captured)
    await submitAndComplete(captured, sessionToken)
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
      setIntent(accepted)
      if (accepted.priceLuna > 0) {
        const record: PersistedTransfer = { intent: accepted, recipientAddress: accepted.toAddress, stage: 'accepted' }
        persist(record)
        await requestPayment(accepted, session.sessionToken)
      } else {
        clearPersisted()
        setState('done')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Acceptance failed.')
      setState('error')
    }
  }

  async function resumeTransfer() {
    const record = restoreTransfer(storage, intentId)
    if (!record) {
      setMessage('No recoverable transfer is saved on this device.')
      setState('idle')
      return
    }
    setIntent(record.intent)
    setState('recovering')
    try {
      const outcome = await authenticateWallet()
      if (outcome.status !== 'success') throw new Error(outcome.status === 'cancelled' ? 'Reconnect the recipient wallet to resume safely.' : outcome.error.message)
      if (outcome.session.walletAddress !== record.recipientAddress) throw new Error('Reconnect the recipient wallet that accepted this transfer. A different wallet cannot recover it.')
      const token = outcome.session.sessionToken
      setSession({ sessionToken: token, walletAddress: outcome.session.walletAddress })

      if (record.stage === 'accepted') {
        await requestPayment(record.intent, token)
        return
      }
      if (record.stage === 'hash_captured' || record.stage === 'submitted') {
        await submitAndComplete(record, token)
        return
      }

      if (!record.intent.paymentIntentId) throw new Error('The saved transfer has no payment intent.')
      const verificationResponse = await fetcher(`/api/payment-intents/${encodeURIComponent(record.intent.paymentIntentId)}/verification`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!verificationResponse.ok) throw new Error('The existing payment could not be checked. Do not pay again; retry recovery.')
      const verification = PaymentVerificationResponseSchema.parse(await verificationResponse.json())
      if (verification.transactionHash) {
        const recovered: PersistedTransfer = {
          ...record,
          stage: 'hash_captured',
          transactionHash: verification.transactionHash,
        }
        persist(recovered)
        await submitAndComplete(recovered, token)
        return
      }
      setMessage('NimTrace has not found a transaction hash yet. Do not pay again. Use “Resume saved transfer” to check again.')
      setState('recovering')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The saved transfer could not be recovered yet.')
      setState('recovering')
    }
  }

  const isPaidTransfer = Boolean(intent && intent.priceLuna > 0)
  const savedTransfer = restoreTransfer(storage, intentId)

  return (
    <main className="transfer-acceptance">
      <nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Recipient-bound transfer</span></nav>
      <section className="transfer-acceptance__card">
        <p className="eyebrow">PASSPORT TRANSFER</p>
        <h1>Receive a product passport.</h1>
        {savedTransfer && state !== 'done' && (
          <div className="transfer-success" role="status">
            <h2>Saved transfer found</h2>
            <p>{message || 'Continue the existing transfer without starting another payment.'}</p>
            <button className="button button--primary" type="button" onClick={() => void resumeTransfer()}>Resume saved transfer</button>
          </div>
        )}
        {!savedTransfer && state === 'idle' && <><p>Connect the recipient wallet to review the complete public proof, transfer price, and exact approval steps before signing anything.</p><button className="button button--primary" type="button" onClick={() => void connectRecipient()}>Review with Nimiq Pay</button></>}
        {state === 'loading' && <p role="status">Loading the signed offer and passport proof…</p>}
        {passport && intent && state !== 'done' && state !== 'error' && state !== 'recovering' && (
          <div className="transfer-review">
            <h2>{passport.product.title}</h2>
            <p>{passport.overallState === 'verified' ? 'Verified passport' : 'Review required'} · Current owner {passport.ownership.maskedCurrentOwner}</p>
            <dl>
              <div><dt>Recipient wallet</dt><dd>{intent.toAddress}</dd></div>
              <div><dt>Transfer type</dt><dd>{isPaidTransfer ? 'Paid resale' : 'Free gift'}</dd></div>
              <div><dt>Price</dt><dd>{isPaidTransfer ? formatNimFromLuna(intent.priceLuna) : 'No NIM payment'}</dd></div>
              <div><dt>Warranty</dt><dd>{passport.warranty.state} until {new Date(passport.warranty.expiresAt).toLocaleDateString()}</dd></div>
              <div><dt>Events</dt><dd>{passport.eventChain.eventCount} linked</dd></div>
            </dl>
            <p className="checkout-notice">{isPaidTransfer ? `You will first sign acceptance. Nimiq Pay will then ask you to approve a direct ${formatNimFromLuna(intent.priceLuna)} payment to the current owner. Ownership settles only after that payment is independently verified.` : 'This is a gift. You will sign acceptance, but no NIM payment will be requested.'}</p>
            <button className="button button--primary" type="button" onClick={() => void accept()}>{isPaidTransfer ? 'Sign acceptance, then pay' : 'Sign acceptance'}</button>
          </div>
        )}
        {state === 'signing' && <p role="status">{isPaidTransfer ? 'Waiting for recipient signature. Payment approval comes next.' : 'Waiting for recipient signature…'}</p>}
        {state === 'recovering' && !savedTransfer && <p role="status">Checking the saved transfer…</p>}
        {state === 'done' && <div className="transfer-success"><h2>Passport received</h2><p>Ownership changed atomically. The former owner no longer has owner actions.</p><a className="button button--secondary" href="/">Back to NimTrace</a></div>}
        {state === 'error' && <div className="transfer-error" role="alert"><p>{message}</p>{savedTransfer ? <button className="button button--secondary" type="button" onClick={() => void resumeTransfer()}>Resume saved transfer</button> : <button className="button button--secondary" type="button" onClick={() => setState('idle')}>Try again</button>}</div>}
      </section>
      <MiniAppTabs />
    </main>
  )
}
