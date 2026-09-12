import { Link } from '@tanstack/react-router'
import { SyncIndicator } from './SyncIndicator'

export function AppBar({ title = 'Crosstune' }: { title?: string }) {
  return (
    <header className="navbar bg-base-200 sticky top-0 z-10 min-h-14 px-4">
      <Link to="/" className="flex-1 text-lg font-semibold">
        {title}
      </Link>
      <SyncIndicator />
    </header>
  )
}
