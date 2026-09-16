import { PageHeading } from '../../components/Page'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { addToList } from '../../commands/lists'
import { updateRecording } from '../../commands/recordings'
import { createSong } from '../../commands/songs'
import { useToast } from '../../components/toastContext'
import { useDb } from '../../db/DbProvider'
import { clearSearchQuery } from '../catalog/searchSession'
import { useInstruments } from '../settings/useInstruments'
import { emptyValues, SongForm } from './SongForm'

export function NewSongScreen() {
  const db = useDb()
  const navigate = useNavigate()
  const { title, attach, list } = useSearch({ from: '/songs/new' })
  const instruments = useInstruments()
  const toast = useToast()
  // Whatever brought the user here, the search that led to it is spent: saving, cancelling, or
  // going back all return to an unfiltered catalog rather than one narrowed to a typed title.
  useEffect(clearSearchQuery, [])
  if (instruments === undefined) return null
  return (
    <div className="space-y-6">
      <PageHeading>New song</PageHeading>
      <SongForm
        submitLabel="Add song"
        instruments={instruments}
        initial={title ? { ...emptyValues(), title } : undefined}
        onCancel={() => void navigate({ to: '/' })}
        onSubmit={async (song, userSong) => {
          const { songId, userSongId } = await createSong(db, song, userSong)
          // The song already exists, so a failed attach or add must not hold the form open
          // where submitting again would create the song a second time.
          if (attach) {
            await updateRecording(db, attach, { song_id: songId }).catch(() =>
              toast.show({ message: 'The recording could not be added to this song.' }),
            )
          }
          if (list) {
            await addToList(db, list, userSongId).catch(() =>
              toast.show({ message: 'The song could not be added to the list.' }),
            )
          }
          await navigate({ to: '/songs/$id', params: { id: songId }, replace: true })
        }}
      />
    </div>
  )
}
