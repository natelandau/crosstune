import { ErrorText } from '../../components/Page'
import { useNavigate } from '@tanstack/react-router'
import { FolderInput, FolderOutput, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { EmptyState } from '../../components/EmptyState'
import { Sheet } from '../../components/Sheet'
import { useAction } from '../../components/useAction'
import type { SwipeRowState } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { isNotUploaded } from '../../db/recordings'
import type { LocalRecordingLink } from '../../db/types'
import { SongSearchPicker } from '../catalog/SongSearchPicker'
import { LinkRow } from '../links/LinkRow'
import { useSyncEngine } from '../../sync/SyncProvider'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { RecordingRow } from './RecordingRow'
import { RenameSheet } from './RenameSheet'
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
  links = [],
  onRemoveLink = () => Promise.resolve(),
  label = 'Recordings',
  rowState,
}: {
  views: RecordingView[]
  /** Linked recordings, listed after the audio recordings as rows of the same shape. */
  links?: LocalRecordingLink[]
  /** Awaited by the list, so a rejection reports under these rows like every other row action. */
  onRemoveLink?: (id: string) => Promise<unknown>
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
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  if (views.length === 0 && links.length === 0) {
    return <EmptyState compact title="No recordings yet" />
  }
  return (
    <>
      <ul className="row-list" aria-label={label}>
        {views.map((view) => (
          <RecordingRow
            key={view.recording.id}
            view={view}
            {...rowState(view.recording.id)}
            actions={[
              {
                label: 'Rename',
                tone: 'neutral',
                icon: <Pencil aria-hidden="true" className="size-5" />,
                onPress: () => setRenaming(view),
              },
              view.songId
                ? {
                    label: 'Remove from song',
                    tone: 'warning',
                    icon: <FolderOutput aria-hidden="true" className="size-5" />,
                    onPress: () =>
                      run(() => updateRecording(db, view.recording.id, { song_id: null })),
                  }
                : {
                    label: 'Add to song',
                    tone: 'warning',
                    icon: <FolderInput aria-hidden="true" className="size-5" />,
                    onPress: () => setAttaching(view.recording.id),
                  },
              {
                label: 'Delete',
                tone: 'error',
                icon: <Trash2 aria-hidden="true" className="size-5" />,
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
        {links.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            {...rowState(link.id)}
            onRemove={(id) => run(() => onRemoveLink(id))}
          />
        ))}
      </ul>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <RenameSheet
        view={renaming}
        onClose={() => setRenaming(null)}
        onSave={(id, label) => {
          setRenaming(null)
          run(() => updateRecording(db, id, { label }))
        }}
      />
      <Sheet open={attaching !== null} title="Add to a song" onClose={() => setAttaching(null)}>
        {/* Mounted only while open: the picker searches the whole catalog, and every list on a screen has one. */}
        {attaching !== null ? (
          <SongSearchPicker
            label="Add to a song"
            rowName={(title) => `Add to ${title}`}
            onPick={(entry) => {
              const id = attaching
              setAttaching(null)
              run(() => updateRecording(db, id, { song_id: entry.song.id }))
            }}
            onCreate={(title) => {
              const id = attaching
              setAttaching(null)
              void navigate({ to: '/songs/new', search: { title, attach: id } })
            }}
          />
        ) : null}
      </Sheet>
    </>
  )
}
