import { useNavigate } from '@tanstack/react-router'
import { createSong } from '../../commands/songs'
import { useDb } from '../../db/DbProvider'
import { useInstruments } from '../settings/useInstruments'
import { SongForm } from './SongForm'

export function NewSongScreen() {
  const db = useDb()
  const navigate = useNavigate()
  const instruments = useInstruments()
  if (instruments === undefined) return null
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">New song</h1>
      <SongForm
        submitLabel="Add song"
        instruments={instruments}
        onCancel={() => void navigate({ to: '/' })}
        onSubmit={async (song, userSong) => {
          const { songId } = await createSong(db, song, userSong)
          await navigate({ to: '/songs/$id', params: { id: songId }, replace: true })
        }}
      />
    </div>
  )
}
