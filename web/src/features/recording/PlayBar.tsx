import { clamp } from '../../math'
import { formatDuration } from '../../text/format'
import { Button } from '../../ui/Button'
import { TransportMark } from '../../ui/rowGlyphs'
import { usePremiumSheet } from '../plan/PremiumSheetProvider'
import { useEngineState } from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { usePlayhead, usePlayheadClock } from '../player/playheadClock'
import { Scrubber } from '../player/Scrubber'
import { QueueControls } from '../player/QueueControls'
import { ELAPSED, PAUSE, PLAY } from '../player/transportCopy'
import { SUBSCRIBE_TO_PLAY } from '../recordings/recordingCopy'

/**
 * The Details tab's slim transport: Play, the elapsed time, a scrubber, and the trimmed length.
 * It drives the player only once the recording is loaded; before that, Play loads it from the
 * scrubbed place, so opening the page never changes what plays. A plan that plays no
 * recordings shows the way to subscribe in place of the place. While a list plays the loaded
 * recording, the list's controls follow, so they are never one tab away.
 */
export function PlayBar({
  engine,
  title,
  lengthMs,
  blocked,
  playable,
  recordingId,
}: {
  /** The page's engine for the recording, from `useRecordingEngine`. */
  engine: PlaybackEngine
  title: string
  /** The trimmed length, known before the audio loads. */
  lengthMs: number
  /** Why the recording cannot play yet, such as a recording still under way. */
  blocked?: string
  /** Whether the plan plays recordings. */
  playable: boolean
  /** The recording the bar plays. */
  recordingId: string
}) {
  const playing = useEngineState(engine, (s) => s.playing)
  const engineLengthMs = useEngineState(engine, (s) => s.lengthMs)
  const playhead = usePlayheadClock(engine)
  const elapsed = usePlayhead(playhead, (ms) => formatDuration(clamp(ms, 0, lengthMs)))
  const premium = usePremiumSheet()
  return (
    <div className="flex flex-col items-center gap-2">
      <div data-play-bar className="flex min-h-(--target-control) w-full items-center gap-2">
        <Button
          glyph={<TransportMark shape={playing ? 'pause' : 'play'} className="size-4" />}
          label={playing ? PAUSE : PLAY}
          iconOnly
          isDisabled={!playable || blocked !== undefined}
          onPress={() => (playing ? engine.pause() : engine.play())}
        />
        {!playable ? (
          <Button
            label={SUBSCRIBE_TO_PLAY}
            onPress={() => premium.open('recordings', 'recording_page')}
          />
        ) : blocked ? (
          <span role="status" className="t-secondary text-secondary min-w-0 flex-1 truncate">
            {blocked}
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span
              role="timer"
              aria-live="off"
              aria-label={ELAPSED(elapsed)}
              className="t-caption t-num text-secondary shrink-0"
            >
              {elapsed}
            </span>
            <Scrubber
              title={title}
              playhead={playhead}
              lengthMs={engineLengthMs}
              onSeek={(ms) => engine.seek(ms)}
            />
            <span className="t-caption t-num text-secondary shrink-0">
              {formatDuration(lengthMs)}
            </span>
          </span>
        )}
      </div>
      <QueueControls tone="bar" recordingId={recordingId} />
    </div>
  )
}
