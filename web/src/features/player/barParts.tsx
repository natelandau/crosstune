import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { DURATION, EASE } from '../../theme/motion'
import { TransportMark } from '../../ui/rowGlyphs'
import { RETRY } from './playerCopy'
import { CLOSE_PLAYER, PAUSE, PITCH_LABEL, PLAY, SPEED_LABEL } from './transportCopy'
import type { RecordingTransport } from './useRecordingTransport'
import { Button } from '../../ui/Button'

/** What both bars show: the loaded item, how to open practice for it, and how to close it. */
export interface BarProps {
  title: string
  /** The tune or the source, in secondary under the title on the phone. */
  detail: string | null
  /** The recording's transport; null for a link, which plays in its own embed. */
  transport: RecordingTransport | null
  /** Opens practice; null leaves the bar's body inert. */
  onOpen: (() => void) | null
  onClose: () => void
  /** Why a list stopped. While set, the bar shows only it and Close player. */
  message?: string | null
  /** The bar mounted for a track after the first, whose title slides in rather than appears. */
  entering?: boolean
}

/**
 * The loaded item's title, which rises into place when the track changes, so a list playing
 * through shows each new tune arriving. The first title shows with the bar itself.
 */
export function TrackTitle({
  title,
  entering = false,
  className,
}: {
  title: string
  entering?: boolean
  className: string
}) {
  return (
    <AnimatePresence initial={entering}>
      <motion.span
        key={title}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.base, ease: EASE }}
        className={className}
      >
        {title}
      </motion.span>
    </AnimatePresence>
  )
}

/** Play and Pause swap in one place, so the control under the finger never moves. */
export function PlayToggle({ transport }: { transport: RecordingTransport }) {
  const playing = transport.state.playing
  return (
    <Button
      glyph={<TransportMark shape={playing ? 'pause' : 'play'} className="size-4" />}
      label={playing ? PAUSE : PLAY}
      iconOnly
      // Nothing is loaded to play until the audio is here.
      isDisabled={transport.status !== null}
      onPress={transport.toggle}
    />
  )
}

/** A list that stopped: its message where the item was, and Close player. */
export function MessageLine({ message }: { message: string }) {
  return (
    <span role="status" className="t-secondary text-ink-2 min-w-0 flex-1 truncate px-2">
      {message}
    </span>
  )
}

export function CloseButton({ onClose }: { onClose: () => void }) {
  return <Button icon={X} label={CLOSE_PLAYER} iconOnly onPress={onClose} />
}

export function RetryButton({ transport }: { transport: RecordingTransport }) {
  if (!transport.canRetry) return null
  return <Button label={RETRY} onPress={transport.retry} />
}

/** The speed and pitch the recording plays at, shown only away from the defaults. */
export function PlaybackBadge({ transport }: { transport: RecordingTransport }) {
  const { speedText, pitchText } = transport
  if (!speedText && !pitchText) return null
  return (
    <span
      data-playback-badge
      className="t-caption t-num bg-fill text-ink inline-flex h-6 shrink-0 items-center gap-1 rounded-(--radius-capsule) px-2"
    >
      {speedText && (
        <span>
          <span className="sr-only">{SPEED_LABEL} </span>
          {speedText}
        </span>
      )}
      {pitchText && (
        <span>
          <span className="sr-only">{PITCH_LABEL} </span>
          {pitchText}
        </span>
      )}
    </span>
  )
}
