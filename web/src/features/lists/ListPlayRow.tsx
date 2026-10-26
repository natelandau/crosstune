import { Shuffle } from 'lucide-react'
import { useId, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { NOTHING_PLAYS, SHUFFLE, WHAT_PLAYS_HINT, willPlayLabel } from './listPlayCopy'
import type { ListItemView } from './useLists'
import { usePlaylistReport } from './usePlaylistReport'
import { usePlaybackEngine, useEngineState } from '../player/PlaybackEngineProvider'
import { PAUSE, PLAY } from '../player/transportCopy'
import { useListPlayback } from '../player/useListPlayback'
import { useRecordState } from '../capture/RecordState'
import { messageFor } from '../../ui/useAction'
import { Button } from '../../ui/Button'
import { WhatPlaysSheet } from './WhatPlaysSheet'
import { PRESS } from '../../ui/press'
import { ActionButtonRow } from '../../ui/ActionButtonRow'
import { TransportMark } from '../../ui/rowGlyphs'

/**
 * Play and Shuffle for a list, over the line that says how many of its tunes will play. The
 * line opens What plays, which says why the rest will not. While the list plays, Play pauses
 * and resumes it; Shuffle always starts it over shuffled. With nothing to play, and the list
 * not playing, only the line shows.
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
  const [explaining, setExplaining] = useState(false)
  const hintId = useId()
  const run = playback.active
  const active = run?.listId === listId && run.message === null
  const pausing = active && playing
  const nothingPlays = report?.playable.length === 0
  const disabled = !report || nothingPlays || recording

  const start = (shuffle: boolean) => {
    playback.start(listId, { shuffle }).catch((caught: unknown) => onError(messageFor(caught)))
  }

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
              isDisabled={active ? !run.settled || recording : disabled}
              onPress={() => {
                if (!active) start(false)
                else if (pausing) engine.pause()
                else engine.play()
              }}
            />
            <Button
              variant="tinted"
              icon={Shuffle}
              label={SHUFFLE}
              fullWidth
              isDisabled={disabled}
              onPress={() => start(true)}
            />
          </ActionButtonRow>
        </div>
      )}
      {/* Held at its height while the sources read, so the rows under it do not shift. */}
      <div className="flex min-h-(--target-control) items-center">
        {report && (
          <AriaButton
            aria-describedby={hintId}
            onPress={() => setExplaining(true)}
            className={`t-secondary text-ink-2 hover:text-ink min-h-(--target-control) text-start underline-offset-4 hover:underline ${PRESS}`}
          >
            {report.playable.length === 0
              ? NOTHING_PLAYS
              : willPlayLabel(report.playable.length, report.total)}
          </AriaButton>
        )}
        <span id={hintId} hidden>
          {WHAT_PLAYS_HINT}
        </span>
      </div>
      {report && (
        <WhatPlaysSheet
          listId={listId}
          report={report}
          rows={rows}
          isOpen={explaining}
          onOpenChange={setExplaining}
        />
      )}
    </div>
  )
}
