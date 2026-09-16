import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { Sheet } from '../../components/Sheet'
import { useAction } from '../../components/useAction'
import type { SwipeRowState } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { isNotUploaded } from '../../db/recordings'
import { useSyncEngine } from '../../sync/SyncProvider'
import { AttachSongPicker } from '../recording/AttachSongPicker'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { RecordingRow } from './RecordingRow'
import type { RecordingView } from './useRecordings'

/** A local file the server has never seen is only ever on this device, so deleting it
 * is unrecoverable in a way a file the server already has is not. */
function confirmMessage(view: RecordingView): string {
  const stuck = view.recording.state === 'pending_upload' && isNotUploaded(view.file)
  return stuck
    ? 'Delete this recording? It has not been uploaded, so this cannot be undone.'
    : 'Delete this recording? It is removed from every device.'
}

export function RecordingList({
  views,
  label = 'Recordings',
  rowState,
}: {
  views: RecordingView[]
  label?: string
  /** Shared by every list on a screen, so only one row is open across all of them. */
  rowState: (id: string) => SwipeRowState
}) {
  const db = useDb()
  const engine = useSyncEngine()
  const navigate = useNavigate()
  const player = usePlayer()
  const { error, run } = useAction()
  const [attaching, setAttaching] = useState<string | null>(null)
  if (views.length === 0) return <p className="text-sm opacity-70">No recordings yet.</p>
  const attachingView = views.find((view) => view.recording.id === attaching)
  return (
    <>
      <ul className="space-y-2" aria-label={label}>
        {views.map((view) => (
          <RecordingRow
            key={view.recording.id}
            view={view}
            {...rowState(view.recording.id)}
            actions={[
              {
                label: view.songId ? 'Move' : 'Add to song',
                tone: 'neutral',
                onPress: () => setAttaching(view.recording.id),
              },
              {
                label: 'Delete',
                tone: 'error',
                onPress: () => {
                  if (!window.confirm(confirmMessage(view))) return
                  const id = view.recording.id
                  if (isPlaying(player, { kind: 'recording', id })) player.close()
                  run(() => deleteRecording(db, id))
                },
              },
            ]}
            onRetry={(id) => run(() => engine.retry(id))}
            onRetryUpload={(id) =>
              run(async () => {
                await retryUpload(db, id)
                void engine.sync()
              })
            }
          />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
      <Sheet
        open={attaching !== null}
        title={attachingView?.songId ? 'Move to a song' : 'Add to a song'}
        onClose={() => setAttaching(null)}
      >
        <AttachSongPicker
          onPick={(songId) => {
            const id = attaching
            setAttaching(null)
            if (id) run(() => updateRecording(db, id, { song_id: songId }))
          }}
          onCreate={(title) => {
            const id = attaching
            setAttaching(null)
            if (id) void navigate({ to: '/songs/new', search: { title, attach: id } })
          }}
        />
      </Sheet>
    </>
  )
}
