import { Link } from '@tanstack/react-router'
import { AudioLines, ListMusic, Music, Settings, type LucideIcon } from 'lucide-react'
import { RecordButton } from '../features/recording/RecordButton'
import { useShownChrome } from '../features/selection/selectionChrome'

const SLIDE =
  'transition-[translate,opacity] duration-(--select-bar-duration) ease-(--ease-emphasized)'
const HIDDEN = 'pointer-events-none motion-reduce:opacity-0'
// The navigation slides past its own height by the record button's cap, which rises above it.
const HIDDEN_NAV = `${HIDDEN} motion-safe:translate-y-[calc(100%+var(--dock-cap))]`
const HIDDEN_TOOLBAR = `${HIDDEN} motion-safe:translate-y-full`

function Tab({
  to,
  icon: Icon,
  label,
  exact = false,
}: {
  to: '/' | '/lists' | '/recordings' | '/settings'
  icon: LucideIcon
  label: string
  exact?: boolean
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      activeProps={{ className: 'dock-active', 'aria-current': 'page' }}
    >
      <Icon aria-hidden="true" className="size-6" />
      <span className="dock-label">{label}</span>
    </Link>
  )
}

export function Dock() {
  const { active, actions } = useShownChrome()
  return (
    <>
      <nav
        className={`dock bg-chrome text-chrome-content ${SLIDE} ${active ? HIDDEN_NAV : ''}`}
        aria-label="Primary"
        inert={active}
        aria-hidden={active}
      >
        <Tab to="/" icon={Music} label="Catalog" exact />
        <Tab to="/lists" icon={ListMusic} label="Lists" />
        <RecordButton />
        <Tab to="/recordings" icon={AudioLines} label="Recordings" />
        <Tab to="/settings" icon={Settings} label="Settings" />
      </nav>
      <div
        role="toolbar"
        aria-label="Selected songs"
        className={`dock bg-neutral text-neutral-content ${SLIDE} ${
          active ? 'delay-(--select-bar-stagger)' : HIDDEN_TOOLBAR
        }`}
        inert={!active}
        aria-hidden={!active}
      >
        {actions}
      </div>
    </>
  )
}
