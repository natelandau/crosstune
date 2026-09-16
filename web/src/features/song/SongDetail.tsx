import { Archive, ArchiveRestore, Link2, ListPlus, Mic, SquarePen, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { removeLink } from '../../commands/links'
import { deleteSong, setArchived, updateSong, updateUserSong } from '../../commands/songs'
import { ActionMenu } from '../../components/ActionMenu'
import { ErrorText, HelpText, Page, PageHeading, Section } from '../../components/Page'
import { EmptyState } from '../../components/EmptyState'
import { usePageActions } from '../../components/pageChrome'
import { useAction } from '../../components/useAction'
import { useOpenRow } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { deleteSongMessage } from './deleteSongMessage'
import { AddLinkForm } from '../links/AddLinkForm'
import { useStartRecording } from '../recording/useStartRecording'
import { UploadRecordingInput } from '../recording/UploadRecordingInput'
import { RecordingList } from '../recordings/RecordingList'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import { useInstruments } from '../settings/useInstruments'
import { SongForm, valuesFromRows } from './SongForm'
import { SongLists } from './SongLists'
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
  const [listPicker, setListPicker] = useState(false)
  const [pasting, setPasting] = useState(false)
  const startRecording = useStartRecording()

  const archived = view?.userSong.archived_at != null
  const actions = useMemo(
    () =>
      view && instruments !== undefined && recordings !== undefined && !edit ? (
        <ActionMenu
          label="More actions"
          items={[
            {
              label: 'Edit',
              icon: <SquarePen aria-hidden="true" className="size-4" />,
              onSelect: () => onEditChange(true),
            },
            {
              label: 'Add to list',
              icon: <ListPlus aria-hidden="true" className="size-4" />,
              onSelect: () => setListPicker(true),
            },
            {
              label: archived ? 'Unarchive' : 'Archive',
              icon: archived ? (
                <ArchiveRestore aria-hidden="true" className="size-4" />
              ) : (
                <Archive aria-hidden="true" className="size-4" />
              ),
              onSelect: () => run(() => setArchived(db, view.userSong.id, !archived)),
            },
            {
              label: 'Delete',
              tone: 'danger',
              icon: <Trash2 aria-hidden="true" className="size-4" />,
              onSelect: () => {
                if (!window.confirm(deleteSongMessage(view.song.title, recordings))) return
                runThen(() => deleteSong(db, view.song.id), onDeleted)
              },
            },
          ]}
        />
      ) : null,
    [view, instruments, recordings, edit, archived, db, onEditChange, onDeleted, run, runThen],
  )
  usePageActions(actions)

  if (view === undefined || instruments === undefined || recordings === undefined) return null
  if (view === null) return <EmptyState title="This song is gone" />
  const { song, userSong, links } = view

  if (edit) {
    return (
      <div className="space-y-6">
        <PageHeading>Edit song</PageHeading>
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
    <Page>
      <header className="space-y-1">
        <PageHeading>{song.title}</PageHeading>
        {song.alternate_titles.length ? (
          <HelpText>{song.alternate_titles.join(', ')}</HelpText>
        ) : null}
        {keyLine ? <p className="text-key">{keyLine}</p> : null}
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <span key={chip.key} className="badge badge-outline">
              {chip.label}
            </span>
          ))}
          {userSong.archived_at ? <span className="badge badge-warning">Archived</span> : null}
        </div>
      </header>

      {/* This line collects the failures of the app bar menu actions and the status control.
          A row action in the recordings list reports under that list instead. */}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <StatusPicker
        value={userSong.status}
        onChange={(status) => run(() => updateUserSong(db, userSong.id, { status }))}
      />

      <Section title="Recordings">
        <RecordingList
          views={recordings}
          links={links}
          onRemoveLink={(id) => removeLink(db, id)}
          rowState={rowState}
        />
        <div role="group" aria-label="Add a recording" className="grid grid-cols-3 gap-2">
          <button type="button" className="btn min-h-11" onClick={() => startRecording(song.id)}>
            <Mic aria-hidden="true" className="size-4" />
            Record
          </button>
          <UploadRecordingInput songId={song.id} label="Upload" className="btn min-h-11" />
          <button
            type="button"
            className={`btn min-h-11 ${pasting ? 'btn-active' : ''}`}
            aria-expanded={pasting}
            onClick={() => setPasting((p) => !p)}
          >
            <Link2 aria-hidden="true" className="size-4" />
            Paste link
          </button>
        </div>
        {pasting ? (
          <AddLinkForm songId={song.id} autoFocus onAdded={() => setPasting(false)} />
        ) : null}
      </Section>

      <SongLists
        userSongId={userSong.id}
        entry={{ song, userSong }}
        pickerOpen={listPicker}
        onPickerOpenChange={setListPicker}
      />

      {userSong.notes || userSong.learned_from || userSong.learned_on ? (
        <Section title="Notes">
          {userSong.learned_from || userSong.learned_on ? (
            <HelpText>
              Learned {userSong.learned_from ? `from ${userSong.learned_from}` : ''}{' '}
              {userSong.learned_on ?? ''}
            </HelpText>
          ) : null}
          {userSong.notes ? <p className="whitespace-pre-wrap">{userSong.notes}</p> : null}
        </Section>
      ) : null}
    </Page>
  )
}
