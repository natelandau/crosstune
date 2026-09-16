import { useMemo, useState } from 'react'
import { DEFAULT_FILTERS, filterCatalog } from '../catalog/filters'
import { SearchSuggestion } from '../catalog/SearchSuggestion'
import { enterAction, searchOutcome } from '../catalog/searchIntent'
import { SongCard } from '../catalog/SongCard'
import { useCatalog } from '../catalog/useCatalog'
import type { Instrument } from '../../db/types'
import { useInstruments } from '../settings/useInstruments'

// Archived songs are searchable here, so every filter is open and only the query narrows.
const PICKER_FILTERS = { ...DEFAULT_FILTERS, archived: true }
const MAX_RESULTS = 8

// A card shows no tunings until the settings row is read, rather than the list waiting on it.
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

/** Search the catalog for the song a recording belongs to, or offer to create one by that name. */
export function AttachSongPicker({
  onPick,
  onCreate,
}: {
  onPick: (songId: string, title: string) => void
  onCreate: (title: string) => void
}) {
  const entries = useCatalog()
  const instruments = useInstruments() ?? NO_INSTRUMENTS
  const [query, setQuery] = useState('')
  const matches = useMemo(
    () => (entries && query.trim() ? filterCatalog(entries, PICKER_FILTERS, query) : []),
    [entries, query],
  )
  const outcome = useMemo(
    () => searchOutcome(entries ?? [], matches, query, true),
    [entries, matches, query],
  )

  const pick = (songId: string, title: string) => {
    onPick(songId, title)
    setQuery('')
  }

  return (
    <div className="space-y-2">
      <label className="input min-h-11 w-full">
        <input
          type="search"
          className="grow"
          aria-label="Add to a song"
          placeholder="Add to a song"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const action = enterAction(query, matches, outcome)
            if (action.kind === 'open') {
              const entry = entries?.find((m) => m.song.id === action.songId)
              if (entry) pick(entry.song.id, entry.song.title)
            } else if (action.kind === 'create') {
              onCreate(action.title)
            }
          }}
        />
      </label>
      {matches.length > 0 ? (
        <ul className="space-y-2">
          {matches.slice(0, MAX_RESULTS).map((entry) => (
            <li key={entry.song.id} className="rounded-box border-base-content/20 border">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => pick(entry.song.id, entry.song.title)}
                aria-label={`Add to ${entry.song.title}`}
              >
                <SongCard entry={entry} instruments={instruments} linked={false} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchSuggestion outcome={outcome} placement="list" onCreate={onCreate} />
    </div>
  )
}
