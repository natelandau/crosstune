import { useMemo, useState } from 'react'
import { DEFAULT_FILTERS, filterCatalog } from '../catalog/filters'
import { useCatalog } from '../catalog/useCatalog'

export function SongPicker({
  excludeUserSongIds,
  onPick,
}: {
  excludeUserSongIds: Set<string>
  onPick: (userSongId: string) => void
}) {
  const entries = useCatalog()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    if (!entries || !query.trim()) return []
    return filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true }, query)
      .filter((e) => !excludeUserSongIds.has(e.userSong.id))
      .slice(0, 8)
  }, [entries, query, excludeUserSongIds])

  return (
    <div className="space-y-2">
      <label className="input min-h-11 w-full">
        <input
          type="search"
          className="grow"
          aria-label="Add a song"
          placeholder="Add a song"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {matches.length ? (
        <ul className="menu rounded-box w-full">
          {matches.map(({ song, userSong }) => (
            <li key={userSong.id}>
              <button
                type="button"
                className="min-h-11"
                onClick={() => {
                  onPick(userSong.id)
                  setQuery('')
                }}
                aria-label={`Add ${song.title}`}
              >
                <span className="badge badge-sm">{song.key ?? '·'}</span>
                {song.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
