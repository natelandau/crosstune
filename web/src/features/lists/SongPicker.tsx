import { useNavigate } from '@tanstack/react-router'
import { SongSearchPicker } from '../catalog/SongSearchPicker'

/** Search the catalog for a song to add to a list, or create one by the typed name and add that. */
export function SongPicker({
  listId,
  inList,
  onPick,
}: {
  listId: string
  /** User song ids already in the list, shown in the results but not offered. */
  inList: ReadonlySet<string>
  onPick: (userSongId: string) => void
}) {
  const navigate = useNavigate()
  return (
    <SongSearchPicker
      label="Add a song"
      rowName={(title) => `Add ${title}`}
      taken={{ ids: inList, label: 'In this list' }}
      onPick={(entry) => onPick(entry.userSong.id)}
      onCreate={(title) => void navigate({ to: '/songs/new', search: { title, list: listId } })}
    />
  )
}
