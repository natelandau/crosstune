import { Link } from '@tanstack/react-router'
import { useShownChrome } from '../features/selection/selectionChrome'

const SLIDE =
  'transition-[translate,opacity] duration-(--select-bar-duration) ease-(--ease-emphasized)'
const HIDDEN = 'pointer-events-none motion-safe:translate-y-full motion-reduce:opacity-0'

export function Dock() {
  const { active, actions } = useShownChrome()
  return (
    <>
      <nav
        className={`dock dock-md ${SLIDE} ${active ? HIDDEN : ''}`}
        aria-label="Primary"
        inert={active}
        aria-hidden={active}
      >
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
      <div
        role="toolbar"
        aria-label="Selected songs"
        className={`dock dock-md bg-neutral text-neutral-content ${SLIDE} ${
          active ? 'delay-(--select-bar-stagger)' : HIDDEN
        }`}
        inert={!active}
        aria-hidden={!active}
      >
        {actions}
      </div>
    </>
  )
}
