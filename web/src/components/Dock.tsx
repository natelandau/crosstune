import { Link } from '@tanstack/react-router'

export function Dock() {
  return (
    <nav className="dock dock-md" aria-label="Primary">
      <Link
        to="/"
        activeOptions={{ exact: true }}
        activeProps={{ className: 'dock-active', 'aria-current': 'page' }}
      >
        <span className="dock-label">Catalog</span>
      </Link>
      <Link to="/lists" activeProps={{ className: 'dock-active', 'aria-current': 'page' }}>
        <span className="dock-label">Lists</span>
      </Link>
      <Link to="/settings" activeProps={{ className: 'dock-active', 'aria-current': 'page' }}>
        <span className="dock-label">Settings</span>
      </Link>
    </nav>
  )
}
