import { destination, type Destination } from './destinations'
import { useDestination } from './useDestination'
import { DestinationLink } from './DestinationLink'
import { RecordControl } from './RecordControl'
import { TAB_BAR } from './tabs'

function Tab({ id }: { id: Destination }) {
  const { current } = useDestination()
  const spec = destination(id)
  const Icon = spec.icon
  const isCurrent = current === id
  return (
    <DestinationLink
      to={id}
      href={spec.root}
      current={isCurrent}
      className={`t-caption flex min-h-14 flex-col items-center justify-center gap-0.5 ${isCurrent ? 'text-slate' : 'text-ink-2'}`}
    >
      <Icon className="size-6" aria-hidden />
      {spec.label}
    </DestinationLink>
  )
}

/** The phone's solid bottom bar: two tabs, the Record dome, two tabs. */
export function TabBar() {
  return (
    <nav
      aria-label={TAB_BAR}
      className="bg-ground border-hairline grid shrink-0 grid-cols-5 items-center border-t pb-[env(safe-area-inset-bottom)]"
    >
      <Tab id="catalog" />
      <Tab id="lists" />
      <RecordControl shape="dome" />
      <Tab id="recordings" />
      <Tab id="settings" />
    </nav>
  )
}
