import { Plus } from 'lucide-react'
import { useRef } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { pickRowName, TUNE_LIST } from '../catalog/catalogCopy'
import type { CatalogEntry } from '../catalog/filters'
import { enterAction } from '../catalog/searchIntent'
import { MAX_RESULTS } from '../catalog/tuneMatches'
import type { TuneMatches } from '../catalog/useTuneMatches'
import { useInstruments } from '../settings/useInstruments'

import { SearchOffer } from '../catalog/SearchOffer'
import { TuneRowView } from '../catalog/TuneRow'
import { ErrorLine } from '../../ui/ErrorLine'
import { RowList } from '../../ui/RowList'
import { SearchField } from '../../ui/SearchField'

// A row shows no tunings until the settings row is read, rather than the results waiting on it.
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

/**
 * The one tune search every picker shows: the field, up to a screenful of matches, and the
 * offer to create a tune by the typed title. A taken tune stays in the results, marked and
 * inert, so a picker never hides a tune.
 */
export function TuneSearchList({
  label,
  query,
  onQuery,
  matches: found,
  onPick,
  onCreate,
  rowName,
  taken,
  hint,
  error,
  keepFocus = false,
}: {
  /** The search field's name, such as "Search tunes". */
  label: string
  query: string
  onQuery: (query: string) => void
  /** The caller's own reading of `query`, so a screen runs one catalog query. */
  matches: TuneMatches
  onPick: (entry: CatalogEntry) => void
  onCreate: (title: string) => void
  /** The name of a row that can be picked, such as "Add Forked Deer". */
  rowName: (title: string) => string
  /** The user tune ids the caller cannot take, and what a taken row says, such as "In this list". */
  taken?: { ids: ReadonlySet<string>; note: string }
  /** Shown in place of the results while the query is blank. */
  hint?: string
  error?: string | null
  /** Hands focus back to the field after a pick, for a picker that takes several in one visit. */
  keepFocus?: boolean
}) {
  const instruments = useInstruments() ?? NO_INSTRUMENTS
  const searchRef = useRef<HTMLInputElement>(null)
  const { entries, matches, outcome } = found
  const shown = matches.slice(0, MAX_RESULTS)
  const isTaken = (entry: CatalogEntry) => taken?.ids.has(entry.userTune.id) ?? false

  const pick = (entry: CatalogEntry) => {
    if (isTaken(entry)) return
    onPick(entry)
    if (keepFocus) searchRef.current?.focus()
  }

  const submit = () => {
    if (!entries) return
    // Every match counts, the taken ones included, so Enter never creates a tune whose title
    // already exists.
    const action = enterAction(query, matches, outcome)
    if (action.kind === 'open') {
      const entry = matches.find((match) => match.tune.id === action.tuneId)
      if (entry) pick(entry)
    } else if (action.kind === 'create') onCreate(action.title)
    else searchRef.current?.blur()
  }

  return (
    <>
      <div className="px-4 pt-2 pb-2">
        <SearchField
          ref={searchRef}
          label={label}
          value={query}
          onChange={onQuery}
          onSubmit={submit}
        />
      </div>
      <ErrorLine error={error} place="bar" />
      {!query.trim() ? (
        hint && <p className="t-secondary text-ink-2 px-4 pt-2">{hint}</p>
      ) : (
        <>
          {shown.length > 0 && (
            <RowList
              label={TUNE_LIST}
              onAction={(key) => {
                const entry = shown.find((match) => match.userTune.id === key)
                if (entry) pick(entry)
              }}
              disabledKeys={shown.filter(isTaken).map((entry) => entry.userTune.id)}
            >
              {shown.map((entry) => {
                const inert = isTaken(entry)
                return (
                  <TuneRowView
                    key={entry.userTune.id}
                    id={entry.userTune.id}
                    entry={entry}
                    instruments={instruments}
                    lead={
                      // The taken rows hold the same width, so every title starts on one line.
                      <Plus
                        aria-hidden
                        className={`size-5 shrink-0 ${inert ? 'invisible' : 'text-slate'}`}
                      />
                    }
                    note={inert ? taken?.note : undefined}
                    name={
                      inert
                        ? undefined
                        : pickRowName(
                            rowName(entry.tune.title),
                            entry.userTune.archived_at !== null,
                          )
                    }
                  />
                )
              })}
            </RowList>
          )}
          <SearchOffer outcome={outcome} onCreate={onCreate} />
        </>
      )}
    </>
  )
}
