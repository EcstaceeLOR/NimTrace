import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PaymentSubmissionResponseSchema,
  PaymentVerificationResponseSchema,
  PurchaseIntentResponseSchema,
  type PaymentVerificationResponse,
  type PublicProductResponse,
  type PurchaseIntentResponse,
} from '@nimtrace/contracts'
import { formatNimFromLuna } from '../../lib/formatting/nim'
import { authenticateWallet } from '../../lib/nimiq/auth'
import { nimiqPayWallet, type NimiqPayWalletAdapter } from '../../lib/nimiq/wallet'

type CheckoutWallet = Pick<
  NimiqPayWalletAdapter,
  'checkConsensus' | 'deepLink' | 'isAvailable' | 'pay'
>

interface CheckoutSession {
  intent: PurchaseIntentResponse
  sessionToken: string
}

interface PersistedCheckout {
  intent: PurchaseIntentResponse
  stage: 'awaiting_wallet' | 'hash_captured' | 'submitted'
  transactionHash?: string
}

type CheckoutState =
  | { status: 'idle' }
  | { status: 'authenticating' }
  | { status: 'review'; active: CheckoutSession; notice?: string }
  | { status: 'paying'; active: CheckoutSession }
  | { status: 'submitting'; active: CheckoutSession; transactionHash: string }
  | { status: 'retry_submission'; active: CheckoutSession; message: string; transactionHash: string }
  | { status: 'reconciling'; record: PersistedCheckout }
  | { status: 'resumable'; message?: string; record: PersistedCheckout }
  | { status: 'submitted'; message: string; record: PersistedCheckout }
  | { status: 'confirmed'; intent: PurchaseIntentResponse; transactionHash: string }
  | { status: 'uncertain'; message: string; record: PersistedCheckout }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string }

interface ProductCheckoutProps {
  authenticate?: typeof authenticateWallet
  fetcher?: typeof fetch
  product: PublicProductResponse
  publicUrl: string
  storage?: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>
  wallet?: CheckoutWallet
}

function storageKey(productId: string) {
  return `nimtrace:checkout:${productId}`
}

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function restoredCheckout(
  storage: ProductCheckoutProps['storage'],
  productId: string,
): PersistedCheckout | undefined {
  try {
    const value = storage?.getItem(storageKey(productId))
    if (!value) return undefined
    const parsed = JSON.parse(value) as Record<string, unknown>
    const intent = PurchaseIntentResponseSchema.safeParse(parsed.intent)
    const stage = parsed.stage
    if (!intent.success || intent.data.productId !== productId
      || !['awaiting_wallet', 'hash_captured', 'submitted'].includes(String(stage))) return undefined
    if ((stage === 'hash_captured' || stage === 'submitted') && !validHash(parsed.transactionHash)) return undefined
    return {
      intent: intent.data,
      stage: stage as PersistedCheckout['stage'],
      ...(validHash(parsed.transactionHash) ? { transactionHash: parsed.transactionHash } : {}),
    }
  } catch {
    return undefined
  }
}

async function responseMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { message?: unknown } | null
  return typeof body?.message === 'string' ? body.message : fallback
}

function idempotencyKey() {
  return `checkout-${crypto.randomUUID()}`
}

function initialCheckoutState(
  storage: ProductCheckoutProps['storage'],
  productId: string,
): CheckoutState {
  const restored = restoredCheckout(storage, productId)
  if (!restored) return { status: 'idle' }
  return { status: 'resumable', record: restored }
}

function pendingMessage(verification: PaymentVerificationResponse) {
  if (verification.state === 'inconclusive') {
    return 'The network provider is temporarily unavailable. Your existing payment remains protected; do not pay again.'
  }
  if (verification.reason === 'awaiting_finality') {
    return `The payment is included with ${verification.confirmations ?? 0} of ${verification.finalityConfirmations} required confirmations.`
  }
  return 'NimTrace is still looking for the existing payment. Do not pay again while its unique tag is reconciled.'
}

export function ProductCheckout({
  authenticate = authenticateWallet,
  fetcher = fetch,
  product,
  publicUrl,
  storage = browserStorage(),
  wallet = nimiqPayWallet,
}: ProductCheckoutProps) {
  const [state, setState] = useState<CheckoutState>(() => initialCheckoutState(storage, product.id))
  const inFlight = useRef(false)
  const deepLink = wallet.deepLink(publicUrl)

  const persist = useCallback((record: PersistedCheckout) => {
    try {
      storage?.setItem(storageKey(product.id), JSON.stringify(record))
    } catch {
      // The in-memory state remains safe when browser storage is unavailable.
    }
  }, [product.id, storage])

  const clearPersisted = useCallback(() => {
    try {
      storage?.removeItem(storageKey(product.id))
    } catch {
      // Nothing else is required when browser storage is unavailable.
    }
  }, [product.id, storage])

  const applyVerification = useCallback((
    record: PersistedCheckout,
    verification: PaymentVerificationResponse,
  ) => {
    const transactionHash = verification.transactionHash ?? record.transactionHash
    if (verification.state === 'verified' && transactionHash) {
      clearPersisted()
      setState({ status: 'confirmed', intent: record.intent, transactionHash })
      return
    }

    if (verification.state === 'rejected') {
      clearPersisted()
      if (verification.reason === 'intent_inactive' && !transactionHash) {
        setState({ status: 'error', message: 'The previous unpaid checkout expired. You can prepare a fresh checkout.' })
        return
      }
      setState({
        status: 'blocked',
        message: 'This payment could not be verified against the signed checkout. Contact the merchant before sending any other payment.',
      })
      return
    }

    const updated: PersistedCheckout = transactionHash
      ? { intent: record.intent, stage: 'submitted', transactionHash }
      : { intent: record.intent, stage: 'awaiting_wallet' }
    persist(updated)
    setState(transactionHash
      ? { status: 'submitted', message: pendingMessage(verification), record: updated }
      : { status: 'uncertain', message: pendingMessage(verification), record: updated })
  }, [clearPersisted, persist])

  const requestVerification = useCallback(async (
    record: PersistedCheckout,
    sessionToken: string,
  ) => {
    const response = await fetcher(`/api/payment-intents/${encodeURIComponent(record.intent.id)}/verification`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
    if (!response.ok) throw new Error(await responseMessage(response, 'Payment status could not be checked.'))
    applyVerification(record, PaymentVerificationResponseSchema.parse(await response.json()))
  }, [applyVerification, fetcher])

  async function prepareCheckout() {
    if (inFlight.current) return
    inFlight.current = true
    setState({ status: 'authenticating' })
    try {
      const authentication = await authenticate()
      if (authentication.status === 'cancelled') {
        setState({ status: 'idle' })
        return
      }
      if (authentication.status === 'error') {
        setState({ status: 'error', message: authentication.error.message })
        return
      }

      const response = await fetcher(`/api/products/${encodeURIComponent(product.id)}/purchase-intents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authentication.session.sessionToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey(),
        },
        body: '{}',
      })
      if (!response.ok) {
        setState({ status: 'error', message: await responseMessage(response, 'Checkout could not be prepared.') })
        return
      }
      const intent = PurchaseIntentResponseSchema.parse(await response.json())
      if (intent.productId !== product.id || intent.productVersion !== product.version) {
        setState({ status: 'error', message: 'The signed product changed. Reload before paying.' })
        return
      }
      if (intent.status !== 'pending') {
        const record: PersistedCheckout = { intent, stage: 'awaiting_wallet' }
        persist(record)
        setState({
          status: 'uncertain',
          record,
          message: intent.status === 'confirmed'
            ? 'This payment is already confirmed. Passport settlement is continuing.'
            : 'An earlier payment attempt must be reconciled before another payment.',
        })
        return
      }
      setState({ status: 'review', active: { intent, sessionToken: authentication.session.sessionToken } })
    } catch {
      setState({ status: 'error', message: 'Checkout is temporarily unavailable. No payment was requested.' })
    } finally {
      inFlight.current = false
    }
  }

  async function submitCaptured(active: CheckoutSession, transactionHash: string) {
    setState({ status: 'submitting', active, transactionHash })
    try {
      const response = await fetcher(`/api/payment-intents/${encodeURIComponent(active.intent.id)}/submissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${active.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transactionHash }),
      })
      if (!response.ok) {
        setState({
          status: 'retry_submission',
          active,
          message: await responseMessage(response, 'The hash is saved on this device but has not reached NimTrace yet.'),
          transactionHash,
        })
        return
      }
      const submission = PaymentSubmissionResponseSchema.parse(await response.json())
      const record: PersistedCheckout = {
        intent: active.intent,
        stage: 'submitted',
        transactionHash: submission.transactionHash,
      }
      persist(record)
      setState({
        status: 'submitted',
        message: 'NimTrace has the transaction hash and is checking independent network finality.',
        record,
      })
      try {
        await requestVerification(record, active.sessionToken)
      } catch {
        // The scheduled reconciler and explicit status check use the same
        // settlement path, so a provider outage never asks the buyer to repay.
      }
    } catch {
      setState({
        status: 'retry_submission',
        active,
        message: 'The hash is saved on this device. Retry sending the hash; do not pay again.',
        transactionHash,
      })
    }
  }

  async function pay(active: CheckoutSession) {
    if (inFlight.current) return
    if (Date.parse(active.intent.expiresAt) <= Date.now()) {
      clearPersisted()
      setState({ status: 'error', message: 'This unpaid checkout expired. Prepare a fresh checkout.' })
      return
    }
    inFlight.current = true
    setState({ status: 'paying', active })
    try {
      const consensus = await wallet.checkConsensus()
      if (consensus.status === 'cancelled') {
        setState({ status: 'review', active, notice: 'Nothing was paid. You can review and try again.' })
        return
      }
      if (consensus.status === 'error') {
        setState({ status: 'review', active, notice: consensus.error.message })
        return
      }

      persist({ intent: active.intent, stage: 'awaiting_wallet' })
      const payment = await wallet.pay({
        recipient: active.intent.sellerAddress,
        valueLuna: active.intent.amountLuna,
        data: active.intent.transactionData,
        validityStartHeight: consensus.value.blockNumber,
      })
      if (payment.status === 'cancelled') {
        clearPersisted()
        setState({ status: 'review', active, notice: 'Payment cancelled. No funds moved.' })
        return
      }
      if (payment.status === 'error') {
        if (['REQUEST_TIMEOUT', 'NETWORK_FAILURE', 'CONFIRMATION_DELAYED', 'UNKNOWN'].includes(payment.error.code)) {
          setState({
            status: 'uncertain',
            record: { intent: active.intent, stage: 'awaiting_wallet' },
            message: `${payment.error.message} Do not pay again while the transaction tag is reconciled.`,
          })
        } else {
          clearPersisted()
          setState({ status: 'review', active, notice: payment.error.message })
        }
        return
      }

      const transactionHash = payment.value.transactionHash
      persist({ intent: active.intent, stage: 'hash_captured', transactionHash })
      await submitCaptured(active, transactionHash)
    } finally {
      inFlight.current = false
    }
  }

  const reconcileExisting = useCallback(async (record: PersistedCheckout) => {
    if (inFlight.current) return
    inFlight.current = true
    setState({ status: 'reconciling', record })
    try {
      const authentication = await authenticate()
      if (authentication.status !== 'success') {
        setState(authentication.status === 'cancelled'
          ? { status: 'resumable', message: 'Reconnect the buyer wallet to check this payment safely.', record }
          : { status: 'resumable', message: authentication.error.message, record })
        return
      }
      if (authentication.session.walletAddress !== record.intent.buyerAddress) {
        setState({ status: 'resumable', message: 'Reconnect the buyer wallet that started this payment.', record })
        return
      }

      let current = record
      if (record.stage === 'hash_captured' && record.transactionHash) {
        const response = await fetcher(`/api/payment-intents/${encodeURIComponent(record.intent.id)}/submissions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authentication.session.sessionToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transactionHash: record.transactionHash }),
        })
        if (!response.ok) throw new Error(await responseMessage(response, 'The saved transaction hash could not be restored.'))
        const submission = PaymentSubmissionResponseSchema.parse(await response.json())
        current = { intent: record.intent, stage: 'submitted', transactionHash: submission.transactionHash }
        persist(current)
      }
      await requestVerification(current, authentication.session.sessionToken)
    } catch (error) {
      setState({
        status: 'resumable',
        message: error instanceof Error ? error.message : 'Payment status could not be checked.',
        record,
      })
    } finally {
      inFlight.current = false
    }
  }, [authenticate, fetcher, persist, requestVerification])

  useEffect(() => {
    const restored = restoredCheckout(storage, product.id)
    if (!restored) return
    const timeout = window.setTimeout(() => void reconcileExisting(restored), 0)
    return () => window.clearTimeout(timeout)
  }, [product.id, reconcileExisting, storage])

  if (!wallet.isAvailable()) {
    return <div className="product-actions"><a className="button button--primary" href={deepLink}>Buy with NIM</a></div>
  }

  return (
    <>
      <div className="product-actions">
        {state.status === 'idle' || state.status === 'error' ? (
          <button className="button button--primary" type="button" onClick={() => void prepareCheckout()}>
            {state.status === 'error' ? 'Retry checkout' : 'Buy with NIM'}
          </button>
        ) : state.status === 'authenticating' ? (
          <button className="button button--primary" type="button" disabled>Connecting wallet…</button>
        ) : null}
      </div>

      {state.status === 'error' && <p className="checkout-error" role="alert">{state.message}</p>}
      {state.status === 'blocked' && <p className="checkout-error" role="alert">{state.message}</p>}

      {(state.status === 'review' || state.status === 'paying') && (
        <section className="checkout-review" aria-labelledby="checkout-title">
          <p className="eyebrow">DIRECT NIM PAYMENT</p>
          <h2 id="checkout-title">Review before paying</h2>
          <dl className="checkout-facts">
            <div><dt>Product</dt><dd>{product.title}</dd></div>
            <div><dt>Merchant recipient</dt><dd>{state.active.intent.sellerAddress}</dd></div>
            <div><dt>Exact amount</dt><dd>{formatNimFromLuna(state.active.intent.amountLuna)}</dd></div>
            <div><dt>Warranty</dt><dd>{product.warrantyDurationDays} days</dd></div>
          </dl>
          <p className="checkout-notice">{state.status === 'review' && state.notice
            ? state.notice
            : 'NIM moves directly from your wallet to the merchant. NimTrace never holds the funds.'}</p>
          <button
            className="button button--primary"
            type="button"
            disabled={state.status === 'paying'}
            onClick={() => void pay(state.active)}
          >
            {state.status === 'paying' ? 'Waiting for Nimiq Pay…' : `Pay ${formatNimFromLuna(state.active.intent.amountLuna)}`}
          </button>
        </section>
      )}

      {state.status === 'submitting' && (
        <p className="checkout-status" role="status">Payment submitted by Nimiq Pay. Saving its transaction hash…</p>
      )}

      {state.status === 'reconciling' && (
        <p className="checkout-status" role="status">Checking the existing payment before another payment can be offered…</p>
      )}

      {state.status === 'retry_submission' && (
        <section className="checkout-status" role="alert">
          <p>{state.message}</p>
          <button className="button button--primary" type="button" onClick={() => void submitCaptured(state.active, state.transactionHash)}>
            Retry status update
          </button>
        </section>
      )}

      {state.status === 'resumable' && (
        <section className="checkout-status" role="status">
          <p>{state.message ?? 'An existing checkout is saved on this device. Reconnect the buyer wallet to check it without paying again.'}</p>
          <button className="button button--primary" type="button" onClick={() => void reconcileExisting(state.record)}>Check payment status</button>
        </section>
      )}

      {state.status === 'submitted' && (
        <section className="checkout-status checkout-status--submitted" role="status">
          <strong>Payment submitted</strong>
          <p>{state.message} This is not yet a completed purchase.</p>
          <code>{state.record.transactionHash}</code>
          <button className="button button--primary" type="button" onClick={() => void reconcileExisting(state.record)}>Check payment status</button>
        </section>
      )}

      {state.status === 'confirmed' && (
        <section className="checkout-status checkout-status--submitted" role="status">
          <strong>Payment confirmed</strong>
          <p>Independent network verification is final. Passport settlement can now continue.</p>
          <code>{state.transactionHash}</code>
        </section>
      )}

      {state.status === 'uncertain' && (
        <section className="checkout-status checkout-status--delayed" role="alert">
          <strong>Payment result delayed</strong>
          <p>{state.message}</p>
          <code>{state.record.intent.transactionData}</code>
          <button className="button button--primary" type="button" onClick={() => void reconcileExisting(state.record)}>Check payment status</button>
        </section>
      )}
    </>
  )
}
