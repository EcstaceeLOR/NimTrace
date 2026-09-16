import { useMemo, useState } from 'react'
import { MiniAppTabs } from '../../components/MiniAppTabs'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'

interface RepairChallenge {
  envelope: Record<string, unknown>
  message: string
  payload: {
    expiresAt: string
    notes: string
    nonce: string
    passportId: string
    previousEventHash: string
    repairerAddress: string
    serviceType: string
    servicedAt: string
  }
  repairId: string
}

function readChallenge(): RepairChallenge | undefined {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get('challenge')
  if (!encoded) return undefined
  try {
    const value = JSON.parse(encoded) as RepairChallenge
    if (!value.repairId || !value.message || !value.payload?.passportId) return undefined
    return value
  } catch {
    return undefined
  }
}

export function RepairAcceptance({ repairId }: { repairId: string }) {
  const challenge = useMemo(readChallenge, [])
  const validChallenge = challenge?.repairId === repairId ? challenge : undefined
  const [state, setState] = useState<'ready' | 'signing' | 'submitted' | 'error'>(validChallenge ? 'ready' : 'error')
  const [message, setMessage] = useState(validChallenge ? '' : 'This repair invitation is missing or malformed.')

  async function signRepair() {
    if (!validChallenge) return
    if (!nimiqPayWallet.isAvailable()) {
      setMessage('Open this repair invitation inside Nimiq Pay to sign it.')
      setState('error')
      return
    }
    setState('signing')
    const signed = await nimiqPayWallet.sign(validChallenge.message)
    if (signed.status !== 'success') {
      setMessage(signed.status === 'cancelled' ? 'Signing cancelled. No repair record was created.' : signed.error.message)
      setState('error')
      return
    }
    try {
      const response = await fetch(`/api/passports/${encodeURIComponent(validChallenge.payload.passportId)}/repairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof: { envelope: validChallenge.envelope, payload: validChallenge.payload, ...signed.value } }),
      })
      if (!response.ok) throw new Error((await response.json().catch(() => null) as { message?: string } | null)?.message ?? 'The repair signature was rejected.')
      setState('submitted')
      setMessage('Repairer signature recorded. Ask the passport owner to acknowledge it.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The repair could not be submitted.')
      setState('error')
    }
  }

  return (
    <main className="repair-acceptance">
      <nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Repairer signing</span></nav>
      <section className="repair-acceptance__card">
        <p className="eyebrow">SIGNED SERVICE RECORD</p>
        {validChallenge ? <><h1>{validChallenge.payload.serviceType}</h1><p>Passport <code>{validChallenge.payload.passportId}</code></p><dl><div><dt>Service date</dt><dd>{new Date(validChallenge.payload.servicedAt).toLocaleDateString()}</dd></div><div><dt>Repairer wallet</dt><dd>{validChallenge.payload.repairerAddress}</dd></div><div><dt>Notes</dt><dd>{validChallenge.payload.notes || 'No notes supplied.'}</dd></div></dl><button className="button button--primary" type="button" disabled={state === 'signing' || state === 'submitted'} onClick={() => void signRepair()}>{state === 'signing' ? 'Waiting for Nimiq Pay…' : state === 'submitted' ? 'Signature recorded' : 'Sign repair record'}</button></> : <p role="alert">This invitation cannot be verified.</p>}
        {message && <p className={state === 'error' ? 'wallet-notice wallet-notice--error' : 'wallet-notice'} role="status">{message}</p>}
      </section>
      <MiniAppTabs />
    </main>
  )
}
