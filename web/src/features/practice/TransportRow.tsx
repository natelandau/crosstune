import { Repeat, RotateCcw, RotateCw } from 'lucide-react'
import { TransportMark } from '../../ui/rowGlyphs'
import { SKIP_BACK, SKIP_FORWARD, SKIP_MS } from '../player/playerCopy'
import { PAUSE, PLAY, REPEAT_LOOP } from '../player/transportCopy'
import { QueueControls } from '../player/QueueControls'
import { IconButton } from '../../ui/IconButton'

/**
 * Practice's transport: skip back, a 72px play and pause, and skip forward. The list's controls
 * follow while a list plays the recording, since the page is then the only player, with no dock
 * or bar.
 *
 * While the audio loads the transport is aria-disabled rather than disabled, so a list moving
 * on can put focus straight onto the new view's control, and it never drops to Close or the
 * page in the meantime.
 */
export function TransportRow({
  playing,
  repeatName,
  disabled,
  onTogglePlay,
  onSkip,
  recordingId,
}: {
  playing: boolean
  /** The selected loop's name while it repeats, which the play button names. */
  repeatName: string | null
  disabled: boolean
  onTogglePlay: () => void
  /** Moves the playhead by `deltaMs`. */
  onSkip: (deltaMs: number) => void
  /** The recording practice shows. */
  recordingId: string
}) {
  return (
    <>
      <div data-practice-transport className="flex items-center justify-center gap-8">
        <IconButton
          size="transport"
          icon={RotateCcw}
          label={SKIP_BACK}
          data-focus-key="skip-back"
          aria-disabled={disabled}
          onPress={() => onSkip(-SKIP_MS)}
        />
        <IconButton
          variant="feature"
          size="feature"
          data-focus-key="play"
          icon={!playing && repeatName ? Repeat : undefined}
          glyph={
            playing || !repeatName ? (
              <TransportMark shape={playing ? 'pause' : 'play'} className="size-7" />
            ) : undefined
          }
          label={playing ? PAUSE : repeatName ? REPEAT_LOOP(repeatName) : PLAY}
          aria-disabled={disabled}
          onPress={onTogglePlay}
        />
        <IconButton
          size="transport"
          icon={RotateCw}
          label={SKIP_FORWARD}
          data-focus-key="skip-forward"
          aria-disabled={disabled}
          onPress={() => onSkip(SKIP_MS)}
        />
      </div>
      <QueueControls tone="practice" recordingId={recordingId} />
    </>
  )
}
