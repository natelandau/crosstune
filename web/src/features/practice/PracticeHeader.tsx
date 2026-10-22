import { ChevronDown, Ellipsis, SkipBack, SkipForward } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent, Ref } from 'react'
import { Button as AriaButton, Heading } from 'react-aria-components'
import { NEXT_TUNE, PREVIOUS_TUNE } from '../player/playerCopy'
import { CLOSE } from '../../ui/confirmCopy'
import type { MenuItem } from '../../ui/menuTypes'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { Menu } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { editLocation } from '../recordings/recordingsCopy'
import { PracticeButton } from './PracticeButton'

/**
 * Practice's header: the close chevron, the recording's title over its subtitle, and More. Off
 * the phone, a playing list's place takes the subtitle's line with Previous tune and Next tune
 * beside it. The recording's location ends the subtitle as a control that opens it. A press on its open space can start the phone's swipe down.
 */
export function PracticeHeader({
  title,
  subtitle,
  location,
  onEditLocation,
  queue,
  menu,
  moreRef,
  onClose,
  onDragStart,
}: {
  title: string
  subtitle: string
  /**
   * The recording's location, a control after the subtitle. Null for none, and while a list's
   * place replaces the subtitle.
   */
  location?: string | null
  onEditLocation?: () => void
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
          className="t-secondary max-w-full overflow-x-clip text-ellipsis whitespace-nowrap text-(--panel-muted)"
        >
          {subtitle}
          {location && (
            <>
              {' · '}
              <AriaButton
                aria-label={editLocation(location)}
                onPress={onEditLocation}
                className="ph-no-capture relative inline cursor-pointer rounded-sm underline decoration-dotted underline-offset-2 hover:text-(--panel-ink) in-[html[data-density=touch]]:after:absolute in-[html[data-density=touch]]:after:inset-x-0 in-[html[data-density=touch]]:after:top-0 in-[html[data-density=touch]]:after:min-h-(--target) in-[html[data-density=touch]]:after:content-['']"
              >
                {location}
              </AriaButton>
            </>
          )}
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
