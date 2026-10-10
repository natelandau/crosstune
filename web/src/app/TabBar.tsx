import { motion, useIsPresent } from 'motion/react'
import { DURATION, EASE } from '../theme/motion'
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
      className={`relative flex h-[52px] flex-col items-center justify-center gap-1 text-[0.625rem] leading-none font-semibold transition-colors duration-(--dur-short) ease-(--ease) ${isCurrent ? 'text-action' : 'text-ink'}`}
    >
      {/* One pill shared across the tabs, so choosing a tab slides it there. */}
      {isCurrent && (
        <motion.span
          layoutId="tab-pill"
          aria-hidden
          className="bg-wash absolute inset-0 rounded-full"
        />
      )}
      <Icon className="relative size-[22px]" aria-hidden />
      <span className="relative">{spec.label}</span>
    </DestinationLink>
  )
}

/**
 * The phone's floating bottom bar: a capsule of four tabs, then the Record disc on its own.
 * Under `AnimatePresence` it sinks below the foot of the screen as a selection bar takes its
 * place and rises back when selecting ends, inert on its way out so nothing there takes a press.
 */
export function TabBar() {
  const present = useIsPresent()
  return (
    <motion.nav
      aria-label={TAB_BAR}
      data-nav
      inert={!present}
      initial={{ y: '150%' }}
      animate={{ y: 0 }}
      exit={{ y: '150%', transition: { duration: DURATION.base, ease: EASE } }}
      className="flex items-center gap-2"
    >
      <div className="bg-nav border-hairline grid h-[62px] min-w-0 flex-1 grid-cols-4 items-center rounded-full border px-1">
        <Tab id="catalog" />
        <Tab id="lists" />
        <Tab id="recordings" />
        <Tab id="settings" />
      </div>
      <RecordControl shape="disc" />
    </motion.nav>
  )
}
