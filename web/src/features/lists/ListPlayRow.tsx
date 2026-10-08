import { Play, Shuffle } from 'lucide-react'
import { useId, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { NOTHING_PLAYS, SHUFFLE, WHAT_PLAYS_HINT, willPlayLabel } from './listPlayCopy'
import type { ListItemView } from './useLists'
import { usePlaylistReport } from './usePlaylistReport'
import { PLAY } from '../player/transportCopy'
import { useListPlayback } from '../player/useListPlayback'
import { useRecordState } from '../capture/RecordState'
import { messageFor } from '../../ui/useAction'
import { Button } from '../../ui/Button'
import { WhatPlaysSheet } from './WhatPlaysSheet'

/**
 * Play and Shuffle for a list, over the line that says how many of its tunes will play. The
 * line opens What plays, which says why the rest will not.
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
  const recording = useRecordState().recording
  const report = usePlaylistReport(rows)
  const [explaining, setExplaining] = useState(false)
  const hintId = useId()
  const disabled = !report || report.playable.length === 0 || recording

  const start = (shuffle: boolean) => {
    playback.start(listId, { shuffle }).catch((caught: unknown) => onError(messageFor(caught)))
  }

  return (
    <div data-list-play className="flex flex-col gap-1 px-4 pb-2">
      <div className="flex gap-3">
        <div className="flex-1">
          <Button
            variant="primary"
            icon={Play}
            label={PLAY}
            fullWidth
            isDisabled={disabled}
            onPress={() => start(false)}
          />
        </div>
        <div className="flex-1">
          <Button
            variant="quiet"
            icon={Shuffle}
            label={SHUFFLE}
            fullWidth
            isDisabled={disabled}
            onPress={() => start(true)}
          />
        </div>
      </div>
      {/* Held at its height while the sources read, so the rows under it do not shift. */}
      <div className="flex min-h-(--target-control) items-center">
        {report && (
          <AriaButton
            aria-describedby={hintId}
            onPress={() => setExplaining(true)}
            className="t-secondary text-ink-2 min-h-(--target-control) text-start data-[pressed]:opacity-60"
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
