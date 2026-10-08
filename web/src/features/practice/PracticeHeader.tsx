import { ChevronDown, Ellipsis, SkipBack, SkipForward } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { Heading } from 'react-aria-components'
import { NEXT_TUNE, PREVIOUS_TUNE } from '../player/playerCopy'
import { CLOSE } from '../../ui/confirmCopy'
import type { MenuItem } from '../../ui/menuTypes'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { Menu } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { PracticeButton } from './PracticeButton'

/**
 * Practice's header: the close chevron, the recording's title over its subtitle, and More. Off
 * the phone, a playing list's place takes the subtitle's line with Previous tune and Next tune
 * beside it. A press on its open space can start the phone's swipe down.
 */
export function PracticeHeader({
  title,
  subtitle,
  queue,
  menu,
  moreRef,
  onClose,
  onDragStart,
}: {
  title: string
  subtitle: string
  /** Set while a list plays off the phone, whose header steps through it. */
  queue?: { onPrevious: () => void; onNext: () => void } | null
  /** More's items, in the shared hook's order, or null until the recording is read. */
  menu: MenuItem[] | null
  moreRef?: Ref<HTMLButtonElement>
  onClose: () => void
  onDragStart?: (event: ReactPointerEvent) => void
}) {
  return (
    <header
      data-practice-header
      className="flex touch-none items-center gap-2 px-2 py-2"
      onPointerDown={onDragStart}
    >
      <PracticeButton icon={ChevronDown} label={CLOSE} onPress={onClose} />
      {queue && <PracticeButton icon={SkipBack} label={PREVIOUS_TUNE} onPress={queue.onPrevious} />}
      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <Heading slot="title" className="t-heading max-w-full truncate">
          {title}
        </Heading>
        <span
          data-recording-subtitle
          className="t-secondary max-w-full truncate text-(--panel-muted)"
        >
          {subtitle}
        </span>
      </div>
      {queue && <PracticeButton icon={SkipForward} label={NEXT_TUNE} onPress={queue.onNext} />}
      <Menu
        label={MORE_ACTIONS}
        trigger={
          <PracticeButton ref={moreRef} icon={Ellipsis} label={MORE_ACTIONS} isDisabled={!menu} />
        }
        items={menu ? menuEntries(menu) : []}
      />
    </header>
  )
}
