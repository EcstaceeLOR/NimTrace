import type { PaymentVerificationResponse, PublicCheckoutProgressResponse } from '@nimtrace/contracts'
import '../../payment-tracker.css'

interface PaymentProgressProps {
  confirmed?: boolean
  publicProgress?: PublicCheckoutProgressResponse | null
  transactionHash?: string
  verification?: PaymentVerificationResponse
}

type StepState = 'complete' | 'current' | 'pending'

interface ProgressStep {
  detail: string
  label: string
  state: StepState
}

function progressState(complete: boolean, current: boolean): StepState {
  if (complete) return 'complete'
  if (current) return 'current'
  return 'pending'
}

export function PaymentProgress({
  confirmed = false,
  publicProgress,
  transactionHash,
  verification,
}: PaymentProgressProps) {
  const hash = verification?.transactionHash ?? transactionHash
  const transactionDetected = publicProgress?.transactionDetected ?? Boolean(hash)
  const included = publicProgress?.included ?? (
    confirmed
    || verification?.state === 'verified'
    || verification?.blockHeight !== null && verification?.blockHeight !== undefined
    || verification?.confirmations !== null && verification?.confirmations !== undefined
  )
  const finalityReached = publicProgress?.finalityReached ?? (confirmed || verification?.state === 'verified')
  const confirmations = publicProgress?.confirmations ?? verification?.confirmations ?? 0
  const required = Math.max(1, publicProgress?.finalityConfirmations ?? verification?.finalityConfirmations ?? 60)
  const blockHeight = publicProgress?.blockHeight ?? verification?.blockHeight
  const finalityPercent = finalityReached
    ? 100
    : Math.min(100, Math.round((confirmations / required) * 100))

  const steps: ProgressStep[] = [
    {
      label: 'Checkout created',
      detail: 'The signed price, seller, product, and unique payment tag are locked.',
      state: 'complete',
    },
    {
      label: 'Transaction detected',
      detail: transactionDetected
        ? publicProgress
          ? 'NimTrace has detected the payment transaction without exposing buyer details.'
          : 'NimTrace has the transaction hash and can follow this exact payment.'
        : 'Waiting for Nimiq Pay or chain discovery to return the payment transaction.',
      state: progressState(transactionDetected, !transactionDetected),
    },
    {
      label: 'Included on Nimiq network',
      detail: included
        ? blockHeight != null
          ? `Included in block ${blockHeight}.`
          : 'The payment is included on-chain.'
        : 'This will check off as soon as the network includes the payment.',
      state: progressState(included, transactionDetected && !included),
    },
    {
      label: 'Network finality',
      detail: finalityReached
        ? `${required} / ${required} confirmations — final.`
        : included
          ? `${confirmations} / ${required} confirmations. NimTrace keeps checking automatically.`
          : `Waiting for inclusion before the ${required}-confirmation finality check begins.`,
      state: progressState(finalityReached, included && !finalityReached),
    },
    {
      label: 'Ownership proof issued',
      detail: confirmed
        ? 'The product passport is issued to the buyer wallet.'
        : finalityReached
          ? 'Payment is final. NimTrace is issuing the ownership proof.'
          : 'Issued automatically after payment finality.',
      state: progressState(confirmed, finalityReached && !confirmed),
    },
  ]

  return (
    <div className="payment-progress" aria-label="Payment progress">
      <ol className="payment-progress__list">
        {steps.map((step) => (
          <li className={`payment-progress__step payment-progress__step--${step.state}`} key={step.label}>
            <span
              className="payment-progress__marker"
              aria-label={step.state === 'complete' ? 'Complete' : step.state === 'current' ? 'In progress' : 'Pending'}
            >
              {step.state === 'complete' ? '✓' : step.state === 'current' ? '•' : ''}
            </span>
            <div className="payment-progress__copy">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
              {step.label === 'Network finality' && included && !finalityReached && (
                <div
                  className="payment-progress__bar"
                  role="progressbar"
                  aria-label="Network finality confirmations"
                  aria-valuemin={0}
                  aria-valuemax={required}
                  aria-valuenow={confirmations}
                >
                  <span style={{ width: `${finalityPercent}%` }} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
