import { Link } from '@tanstack/react-router'
import { useShownChrome } from '../features/selection/selectionChrome'
import { Lockup } from './Mark'
import { SyncIndicator } from './SyncIndicator'

// Both layers share one grid cell so they crossfade in place.
const LAYER =
  'col-start-1 row-start-1 mx-auto flex w-full max-w-(--measure) min-w-0 items-center gap-2 px-4 transition-[opacity,translate] duration-(--select-bar-duration) ease-(--ease-emphasized)'

export function AppBar() {
  const { active, bar } = useShownChrome()
  return (
    <header
      className={`navbar sticky top-0 z-10 grid min-h-14 p-0 pt-[env(safe-area-inset-top)] transition-colors duration-(--select-bar-duration) ease-out ${
        active ? 'bg-neutral text-neutral-content' : 'bg-chrome text-chrome-content'
      }`}
    >
      <div
        className={`${LAYER} ${active ? 'pointer-events-none opacity-0 motion-safe:translate-y-2' : ''}`}
        inert={active}
        aria-hidden={active}
      >
        <Link to="/" className="text-brand flex-1">
          <Lockup />
        </Link>
        <SyncIndicator />
      </div>
      <div
        className={`${LAYER} ${active ? '' : 'pointer-events-none opacity-0 motion-safe:-translate-y-2'}`}
        inert={!active}
        aria-hidden={!active}
      >
        {bar}
      </div>
    </header>
  )
}
