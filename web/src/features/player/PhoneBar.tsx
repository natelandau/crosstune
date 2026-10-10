import { Button as AriaButton } from 'react-aria-components'
import { OPEN_RECORDING } from './transportCopy'
import {
  CloseButton,
  MessageLine,
  PlaybackBadge,
  PlayToggle,
  RetryButton,
  TrackTitle,
  type BarProps,
} from './barParts'
import { transportNotice } from './transportNotice'

/**
 * Now playing on the phone: a card floating directly above the tab bar. Play and Pause lead, then
 * the title over its tune or source, the speed and pitch badge, and Close. A press on the
 * body opens practice. A list's controls live in practice, never here.
 */
export function PhoneBar({
  title,
  detail,
  transport,
  onOpen,
  onClose,
  message,
  entering,
}: BarProps) {
  const frame = 'flex min-h-14 items-center gap-1 px-2 py-1'
  if (message) {
    return (
      <div data-phone-bar className={frame}>
        <MessageLine message={message} />
        <CloseButton onClose={onClose} />
      </div>
    )
  }
  const notice = transport ? transportNotice(transport) : null
  const lines = (
    <>
      <TrackTitle title={title} entering={entering} className="t-body max-w-full truncate" />
      {!notice && detail && (
        <span className="t-secondary text-ink-2 max-w-full truncate">{detail}</span>
      )}
    </>
  )
  return (
    <div data-phone-bar className={frame}>
      {transport && <PlayToggle transport={transport} />}
      <div className="flex min-h-(--target) min-w-0 flex-1 flex-col justify-center px-2">
        {onOpen ? (
          <AriaButton
            aria-label={OPEN_RECORDING(title)}
            onPress={onOpen}
            className="flex min-w-0 flex-col items-start text-start"
          >
            {lines}
          </AriaButton>
        ) : (
          lines
        )}
        {/* Outside the press target, whose name would hide it from a screen reader. */}
        {notice && (
          <span role="status" className="t-secondary text-ink-2 truncate">
            {notice}
          </span>
        )}
      </div>
      {transport &&
        (notice ? <RetryButton transport={transport} /> : <PlaybackBadge transport={transport} />)}
      <CloseButton onClose={onClose} />
    </div>
  )
}
