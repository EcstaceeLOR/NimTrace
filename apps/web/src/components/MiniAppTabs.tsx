export function MiniAppTabs() {
  const path = window.location.pathname
  const links = [
    ['/', 'Home'],
    ['/verify', 'Verify'],
    ['/catalogue', 'Browse'],
    ['/issue', 'Issue'],
    ['/wallet', 'Wallet'],
    ['/merchant', 'Studio'],
  ] as const

  return (
    <nav className="miniapp-tabs" aria-label="Mini App navigation">
      {links.map(([href, label]) => (
        <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>
      ))}
    </nav>
  )
}
