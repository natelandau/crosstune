import { useMemo, useState } from 'react'
import { DEFAULT_FILTERS, filterCatalog } from '../catalog/filters'
import { useCatalog } from '../catalog/useCatalog'

export function AttachSongPicker({ onPick }: { onPick: (songId: string, title: string) => void }) {
  const entries = useCatalog()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    if (!entries || !query.trim()) return []
    return filterCatalog(entries, { ...DEFAULT_FILTERS, archived: true }, query).slice(0, 8)
  }, [entries, query])

  return (
    <div className="space-y-2">
      <label className="input min-h-11 w-full">
        <input
          type="search"
          className="grow"
          aria-label="Attach to a song"
          placeholder="Attach to a song"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // The picker sits inside the save form, where Enter would save before a song is picked.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
        />
      </label>
      {matches.length ? (
        <ul className="menu bg-base-200 rounded-box w-full">
          {matches.map(({ song }) => (
            <li key={song.id}>
              <button
                type="button"
                className="min-h-11"
                onClick={() => {
                  onPick(song.id, song.title)
                  setQuery('')
                }}
                aria-label={`Attach to ${song.title}`}
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
