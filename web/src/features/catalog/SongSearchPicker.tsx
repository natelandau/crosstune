import { X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Instrument } from '../../db/types'
import { useInstruments } from '../settings/useInstruments'
import { DEFAULT_FILTERS, filterCatalog, type CatalogEntry } from './filters'
import { SearchSuggestion } from './SearchSuggestion'
import { enterAction, searchOutcome } from './searchIntent'
import { SongCard } from './SongCard'
import { useCatalog } from './useCatalog'

// Archived songs are searchable here, so every filter is open and only the query narrows.
const PICKER_FILTERS = { ...DEFAULT_FILTERS, archived: true }
const MAX_RESULTS = 8

// A card shows no tunings until the settings row is read, rather than the list waiting on it.
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

/**
 * Search the catalog for a song to hand to the caller, or offer to create one by the typed
 * name. The same box, rows, and Enter rules serve every picker, so a song is found the same
 * way whether it is being added to a list or given a recording.
 */
export function SongSearchPicker({
  label,
  rowName,
  taken,
  onPick,
  onCreate,
}: {
  /** Names the search box and is its placeholder. */
  label: string
  /** The accessible name of a result row, built from the song's title. */
  rowName: (title: string) => string
  /** Songs the caller cannot take, by user song id, shown with the reason instead of hidden. */
  taken?: { ids: ReadonlySet<string>; label: string }
  onPick: (entry: CatalogEntry) => void
  onCreate: (title: string) => void
}) {
  const entries = useCatalog()
  const instruments = useInstruments() ?? NO_INSTRUMENTS
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(
    () => (entries && query.trim() ? filterCatalog(entries, PICKER_FILTERS, query) : []),
    [entries, query],
  )
  const outcome = useMemo(
    () => searchOutcome(entries ?? [], matches, query, true),
    [entries, matches, query],
  )
  const isTaken = (entry: CatalogEntry) => taken?.ids.has(entry.userSong.id) ?? false

  const pick = (entry: CatalogEntry) => {
    onPick(entry)
    setQuery('')
  }

  return (
    <div className="space-y-2">
      <label className="input min-h-11 w-full">
        <input
          ref={searchRef}
          type="search"
          // The native cancel button is missing in Firefox and too small to tap in WebKit.
          className="grow [&::-webkit-search-cancel-button]:appearance-none"
          aria-label={label}
          placeholder={label}
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            // Every match counts here, taken ones included, so Enter never creates a song
            // whose title already exists; a lone taken match then simply does nothing.
            const action = enterAction(query, matches, outcome)
            if (action.kind === 'open') {
              const entry = matches.find((m) => m.song.id === action.songId)
              if (entry && !isTaken(entry)) pick(entry)
            } else if (action.kind === 'create') {
              onCreate(action.title)
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="btn btn-ghost btn-circle btn-sm -mr-2"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              searchRef.current?.focus()
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </label>
      {matches.length > 0 ? (
        <ul className="space-y-2">
          {matches.slice(0, MAX_RESULTS).map((entry) => (
            <li key={entry.song.id} className="rounded-box border-base-content/20 border">
              {taken && isTaken(entry) ? (
                <div className="flex items-center opacity-60">
                  <div className="min-w-0 flex-1">
                    <SongCard entry={entry} instruments={instruments} linked={false} />
                  </div>
                  <span className="text-meta shrink-0 pr-3">{taken.label}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => pick(entry)}
                  aria-label={rowName(entry.song.title)}
                >
                  <SongCard entry={entry} instruments={instruments} linked={false} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <SearchSuggestion outcome={outcome} placement="list" onCreate={onCreate} />
    </div>
  )
}
