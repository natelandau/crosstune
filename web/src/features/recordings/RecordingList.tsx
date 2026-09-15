import { useState } from 'react'
import { deleteRecording, retryUpload, setPinned, updateRecording } from '../../commands/recordings'
import { Sheet } from '../../components/Sheet'
import { useAction } from '../../components/useAction'
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
  showSong,
  label = 'Recordings',
}: {
  views: RecordingView[]
  showSong: boolean
  label?: string
}) {
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const { error, run } = useAction()
  const [attaching, setAttaching] = useState<string | null>(null)
  if (views.length === 0) return <p className="text-sm opacity-70">No recordings yet.</p>
  return (
    <>
      <ul className="space-y-2" aria-label={label}>
        {views.map((view) => (
          <RecordingRow
            key={view.recording.id}
            view={view}
            showSong={showSong}
            onDelete={() => {
              if (!window.confirm(confirmMessage(view))) return
              const id = view.recording.id
              if (isPlaying(player, { kind: 'recording', id })) player.close()
              run(() => deleteRecording(db, id))
            }}
            onRetry={(id) => run(() => engine.retry(id))}
            onRetryUpload={(id) =>
              run(async () => {
                await retryUpload(db, id)
                void engine.sync()
              })
            }
            onAttach={(id) => setAttaching(id)}
            onTogglePin={(id, on) => run(() => setPinned(db, [id], on))}
          />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
      <Sheet open={attaching !== null} title="Attach to a song" onClose={() => setAttaching(null)}>
        <AttachSongPicker
          onPick={(songId) => {
            const id = attaching
            setAttaching(null)
            if (id) run(() => updateRecording(db, id, { song_id: songId }))
          }}
        />
      </Sheet>
    </>
  )
}
