import { useState } from 'react'

export function MiniAppTabs() {
  const [showActions, setShowActions] = useState(false)
  const path = window.location.pathname
  const links = [
    ['/', 'Home'],
    ['/catalogue', 'Browse'],
    ['/verify', 'Verify'],
    ['/wallet', 'Wallet'],
  ] as const

  function isActive(href: string) {
    if (href === '/') return path === '/'
    if (href === '/catalogue') return path === '/catalogue' || path.startsWith('/products/')
    if (href === '/verify') return path === '/verify' || path.startsWith('/passports/')
    if (href === '/wallet') return path === '/wallet'
    return path === href
  }

  return (
    <>
      {showActions && (
        <button
          className="miniapp-actions-backdrop"
          type="button"
          aria-label="Close quick actions"
          onClick={() => setShowActions(false)}
        />
      )}
      {showActions && (
        <section id="miniapp-quick-actions" className="miniapp-actions-sheet" aria-label="Create and manage">
          <div>
            <p className="eyebrow">QUICK ACTIONS</p>
            <strong>Create & manage</strong>
          </div>
          <a href="/issue">Issue a product</a>
          <a href="/merchant">Merchant Studio</a>
        </section>
      )}
      <button
        className="miniapp-create-button"
        type="button"
        aria-label="Create and manage"
        aria-expanded={showActions}
        aria-controls="miniapp-quick-actions"
        onClick={() => setShowActions((open) => !open)}
      >
        <span aria-hidden="true">+</span>
        <span>Create</span>
      </button>
      <nav className="miniapp-tabs" aria-label="Mini App navigation">
        {links.map(([href, label]) => (
          <a key={href} href={href} aria-current={isActive(href) ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
    </>
  )
}
