import { Repeat, RotateCcw, RotateCw } from 'lucide-react'
import { TransportMark } from '../../ui/rowGlyphs'
import { SKIP_BACK, SKIP_FORWARD, SKIP_MS } from '../player/playerCopy'
import { PAUSE, PLAY, REPEAT_LOOP } from '../player/transportCopy'
import { useFrame } from '../../platform/frame'
import { QueueControls } from '../player/QueueControls'
import { PracticeButton } from './PracticeButton'

/**
 * Practice's transport: skip back, a 72px play and pause, and skip forward. On the phone,
 * whose bar has no room for them, the list's controls follow while a list plays.
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
}: {
  playing: boolean
  /** The selected loop's name while it repeats, which the play button names. */
  repeatName: string | null
  disabled: boolean
  onTogglePlay: () => void
  /** Moves the playhead by `deltaMs`. */
  onSkip: (deltaMs: number) => void
}) {
  const phone = useFrame() === 'phone'
  return (
    <>
      <div data-practice-transport className="flex items-center justify-center gap-6">
        <PracticeButton
          icon={RotateCcw}
          label={SKIP_BACK}
          data-focus-key="skip-back"
          aria-disabled={disabled}
          onPress={() => onSkip(-SKIP_MS)}
        />
        <PracticeButton
          size="large"
          data-focus-key="play"
          icon={!playing && repeatName ? Repeat : undefined}
          iconClassName="size-8"
          glyph={
            playing || !repeatName ? (
              <TransportMark shape={playing ? 'pause' : 'play'} className="size-7" />
            ) : undefined
          }
          label={playing ? PAUSE : repeatName ? REPEAT_LOOP(repeatName) : PLAY}
          aria-disabled={disabled}
          onPress={onTogglePlay}
        />
        <PracticeButton
          icon={RotateCw}
          label={SKIP_FORWARD}
          data-focus-key="skip-forward"
          aria-disabled={disabled}
          onPress={() => onSkip(SKIP_MS)}
        />
      </div>
      {phone && <QueueControls tone="practice" />}
    </>
  )
}
