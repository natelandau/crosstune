import { removeLink } from '../../commands/links'
import { deleteSong, setArchived, updateSong, updateUserSong } from '../../commands/songs'
import { EmptyState } from '../../components/EmptyState'
import { useAction } from '../../components/useAction'
import { useOpenRow } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { deleteSongMessage } from './deleteSongMessage'
import { AddLinkForm } from '../links/AddLinkForm'
import { AddToListMenu } from '../lists/AddToListMenu'
import { UploadRecordingInput } from '../recording/UploadRecordingInput'
import { RecordingList } from '../recordings/RecordingList'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import { useInstruments } from '../settings/useInstruments'
import { SongForm, valuesFromRows } from './SongForm'
import { StatusPicker } from './StatusPicker'
import { useSong } from './useSong'

interface Props {
  songId: string
  edit: boolean
  onEditChange: (edit: boolean) => void
  onDeleted: () => void
}

export function SongDetail({ songId, edit, onEditChange, onDeleted }: Props) {
  const db = useDb()
  const view = useSong(songId)
  const instruments = useInstruments()
  const recordings = useRecordingsWithFiles({ songId })
  const { error, run, runThen } = useAction()
  const rowState = useOpenRow()

  if (view === undefined || instruments === undefined || recordings === undefined) return null
  if (view === null) return <EmptyState title="This song is gone" />
  const { song, userSong, links } = view

  if (edit) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Edit song</h1>
        <SongForm
          initial={valuesFromRows(song, userSong)}
          submitLabel="Save"
          instruments={instruments}
          onCancel={() => onEditChange(false)}
          onSubmit={async (songInput, userSongInput) => {
            await updateSong(db, song.id, songInput)
            await updateUserSong(db, userSong.id, userSongInput)
            onEditChange(false)
          }}
        />
      </div>
    )
  }

  const keyLine = [song.key, song.mode].filter(Boolean).join(' ')
  const chips = [
    { key: 'violin_tuning', label: song.violin_tuning },
    { key: 'banjo_tuning', label: song.banjo_tuning },
    { key: 'time_signature', label: song.time_signature },
    { key: 'is_crooked', label: song.is_crooked ? 'Crooked' : null },
    { key: 'feel', label: song.feel },
    { key: 'genre', label: song.genre },
    { key: 'part_structure', label: song.part_structure },
    { key: 'has_lyrics', label: song.has_lyrics ? 'Lyrics' : null },
  ].filter((c): c is { key: string; label: string } => !!c.label)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{song.title}</h1>
        {song.alternate_titles.length ? (
          <p className="text-sm opacity-70">{song.alternate_titles.join(', ')}</p>
        ) : null}
        {keyLine ? <p className="text-xl font-semibold">{keyLine}</p> : null}
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span key={chip.key} className="badge badge-outline">
              {chip.label}
            </span>
          ))}
          {userSong.archived_at ? <span className="badge badge-warning">Archived</span> : null}
        </div>
      </header>

      <StatusPicker
        value={userSong.status}
        onChange={(status) => run(() => updateUserSong(db, userSong.id, { status }))}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Recordings</h2>
        <RecordingList
          views={recordings}
          links={links}
          onRemoveLink={(id) => run(() => removeLink(db, id))}
          rowState={rowState}
        />
        <UploadRecordingInput songId={song.id} />
        <AddLinkForm songId={song.id} />
      </section>

      <AddToListMenu userSongId={userSong.id} />

      {userSong.notes || userSong.learned_from || userSong.learned_on ? (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold uppercase opacity-60">Notes</h2>
          {userSong.learned_from || userSong.learned_on ? (
            <p className="text-sm opacity-70">
              Learned {userSong.learned_from ? `from ${userSong.learned_from}` : ''}{' '}
              {userSong.learned_on ?? ''}
            </p>
          ) : null}
          {userSong.notes ? <p className="whitespace-pre-wrap">{userSong.notes}</p> : null}
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" className="btn min-h-11 flex-1" onClick={() => onEditChange(true)}>
          Edit
        </button>
        <button
          type="button"
          className="btn min-h-11"
          onClick={() => run(() => setArchived(db, userSong.id, !userSong.archived_at))}
        >
          {userSong.archived_at ? 'Unarchive' : 'Archive'}
        </button>
        <button
          type="button"
          className="btn btn-outline btn-error min-h-11"
          onClick={() => {
            if (!window.confirm(deleteSongMessage(song.title, recordings))) return
            runThen(() => deleteSong(db, song.id), onDeleted)
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
