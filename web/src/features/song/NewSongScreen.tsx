import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'
import { createSong } from '../../commands/songs'
import { useDb } from '../../db/DbProvider'
import { clearSearchQuery } from '../catalog/searchSession'
import { useInstruments } from '../settings/useInstruments'
import { emptyValues, SongForm } from './SongForm'

export function NewSongScreen() {
  const db = useDb()
  const navigate = useNavigate()
  const { title } = useSearch({ from: '/songs/new' })
  const instruments = useInstruments()
  // Whatever brought the user here, the search that led to it is spent: saving, cancelling, or
  // going back all return to an unfiltered catalog rather than one narrowed to a typed title.
  useEffect(clearSearchQuery, [])
  if (instruments === undefined) return null
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">New song</h1>
      <SongForm
        submitLabel="Add song"
        instruments={instruments}
        initial={title ? { ...emptyValues(), title } : undefined}
        onCancel={() => void navigate({ to: '/' })}
        onSubmit={async (song, userSong) => {
          const { songId } = await createSong(db, song, userSong)
          await navigate({ to: '/songs/$id', params: { id: songId }, replace: true })
        }}
      />
    </div>
  )
}
