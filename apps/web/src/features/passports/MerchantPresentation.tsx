import { useEffect, useState } from 'react'
import { MerchantWarrantyPresentationSchema, type MerchantWarrantyPresentation } from '@nimtrace/contracts'

export function MerchantPresentation({ fetcher = fetch, token }: { fetcher?: typeof fetch; token: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; value: MerchantWarrantyPresentation } | { status: 'error' }>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    void fetcher(`/api/presentations/${encodeURIComponent(token)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error()
      setState({ status: 'ready', value: MerchantWarrantyPresentationSchema.parse(await response.json()) })
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [fetcher, token])
  if (state.status === 'loading') return <main className="verification-loading" role="status"><h1>Loading presentation…</h1></main>
  if (state.status === 'error') return <main className="verification-error" role="alert"><h1>Presentation expired</h1><p>Ask the owner to generate a fresh merchant QR.</p></main>
  const { passport, expiresAt } = state.value
  return <main className="merchant-presentation"><nav className="nav"><a className="brand" href="/"><img className="brand-logo" src="/nimtrace-logo-v1.png" alt="NimTrace" />NimTrace</a><span>Merchant read-only view</span></nav><section className="merchant-presentation__card"><p className="eyebrow">WARRANTY PRESENTATION · NOT A CLAIM</p><h1>{passport.product.title}</h1><p className="merchant-presentation__notice">This short-lived presentation displays evidence for review. It is not a legal entitlement, warranty claim acceptance, or service authorization.</p><dl><div><dt>Product version</dt><dd>{passport.product.version}</dd></div><div><dt>Purchase transaction</dt><dd>{passport.purchase.transactionHash}</dd></div><div><dt>Current owner</dt><dd>{passport.ownership.maskedCurrentOwner}</dd></div><div><dt>Warranty</dt><dd>{passport.warranty.state} · {passport.warranty.daysRemaining} days remaining</dd></div><div><dt>Evidence checked</dt><dd>{new Date(passport.checkedAt).toLocaleString()}</dd></div></dl><p className="verification-footer">Presentation expires {new Date(expiresAt).toLocaleString()}.</p></section></main>
}
