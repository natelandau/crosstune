import { Shuffle } from 'lucide-react'
import { NOTHING_PLAYS, SHUFFLE, willPlayLabel } from './listPlayCopy'
import type { ListItemView } from './useLists'
import { usePlaylistReport } from './usePlaylistReport'
import { usePlaybackEngine, useEngineState } from '../player/PlaybackEngineProvider'
import { PAUSE, PLAY } from '../player/transportCopy'
import { useActiveListRun, useListPlayback } from '../player/useListPlayback'
import { useRecordState } from '../capture/RecordState'
import { messageFor } from '../../ui/useAction'
import { Button } from '../../ui/Button'
import { ActionButtonRow } from '../../ui/ActionButtonRow'
import { TransportMark } from '../../ui/rowGlyphs'

/**
 * Play and Shuffle for a list, over the line that says how many of its tunes will play. While
 * the list plays, Play pauses and resumes it; Shuffle always starts it over shuffled. With
 * nothing to play, and the list not playing, only the line shows.
 */
export function ListPlayRow({
  listId,
  rows,
  onError,
}: {
  listId: string
  /** The rows the list shows, in order. */
  rows: readonly ListItemView[]
  onError: (message: string) => void
}) {
  const playback = useListPlayback()
  const engine = usePlaybackEngine()
  const playing = useEngineState(engine, (state) => state.playing)
  const recording = useRecordState().recording
  const report = usePlaylistReport(rows)
  const run = useActiveListRun(listId)
  const active = run !== null
  const pausing = active && playing
  const nothingPlays = report?.playable.length === 0
  const disabled = !report || nothingPlays || recording

  const start = (shuffle: boolean) => playback.start(listId, { shuffle })
  const failed = (caught: unknown) => onError(messageFor(caught))

  return (
    <div data-list-play className="flex flex-col gap-1 px-4 pb-2">
      {(active || !nothingPlays) && (
        // Held in place, unseen, while the sources read, so the rows under it do not shift.
        <div className={report || active ? undefined : 'invisible'}>
          <ActionButtonRow>
            <Button
              variant="primary"
              glyph={<TransportMark shape={pausing ? 'pause' : 'play'} className="size-4" />}
              label={pausing ? PAUSE : PLAY}
              fullWidth
              // Until the next tune loads, the engine holds the one being left.
              isDisabled={run ? !run.settled || recording : disabled}
              // Playing is its own confirmation.
              showDone={false}
              onFailed={failed}
              onPress={() => {
                if (!active) return start(false)
                if (pausing) engine.pause()
                else engine.play()
              }}
            />
            <Button
              variant="secondary"
              icon={Shuffle}
              label={SHUFFLE}
              fullWidth
              isDisabled={disabled}
              showDone={false}
              onFailed={failed}
              onPress={() => start(true)}
            />
          </ActionButtonRow>
        </div>
      )}
      {/* Held at its height while the sources read, so the rows under it do not shift. */}
      <div className="flex min-h-(--size-regular) items-center">
        {report && (
          <p className="t-secondary text-secondary">
            {report.playable.length === 0
              ? NOTHING_PLAYS
              : willPlayLabel(report.playable.length, report.total)}
          </p>
        )}
      </div>
    </div>
  )
}
