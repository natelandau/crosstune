import { IonItem, IonLabel, IonNote } from '@ionic/react'
import { Plus } from 'lucide-react'
import { useMemo, useRef } from 'react'
import type { Instrument } from '../../api/vocabulary'
import { Group } from '../../ui/Group'
import { SearchField, type SearchFieldHandle } from '../../ui/SearchField'
import { useInstruments } from '../settings/useInstruments'
import { DEFAULT_FILTERS, filterCatalog, type CatalogEntry } from './filters'
import { enterAction, searchOutcome, type SearchOutcome } from './searchIntent'
import { TuneItem, TuneLines } from './TuneItem'
import { useCatalog } from './useCatalog'

export const SEARCH_TUNES = 'Search tunes'

// Archived tunes are searchable in every picker, so each filter is open and only the query narrows.
const PICKER_FILTERS = { ...DEFAULT_FILTERS, archived: true }
const MAX_RESULTS = 8

// A row shows no tunings until the settings row is read, rather than the results waiting on it.
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

const NOTHING_TAKEN: ReadonlySet<string> = new Set()

// An unread catalog looks exactly like a catalog holding no such tune, so the search offers
// nothing until it has been read; otherwise a query typed as the picker opens offers to create a
// tune that is already there.
const UNREAD: SearchOutcome = { kind: 'none' }

/**
 * Search the catalog for a tune to hand to the caller, or offer to create one by the typed name.
 * One box, one set of rows, and one set of Enter rules serve every picker, so a tune is found the
 * same way whether it is being added to a list or given a recording.
 */
export function TuneSearch({
  name,
  taken = NOTHING_TAKEN,
  takenLabel,
  rowName,
  onPick,
  onCreate,
  query,
  onQuery,
  keepFocus = false,
}: {
  /** The search field's name, such as "Search tunes". */
  name: string
  /** Tunes the caller cannot take, by user tune id. */
  taken?: ReadonlySet<string>
  /** The note shown on a taken row, such as "In this list". */
  takenLabel?: string
  /** The name of an addable row, such as (title) => `Add to ${title}`. */
  rowName: (title: string) => string
  onPick: (entry: CatalogEntry) => void
  onCreate: (title: string) => void
  /** Cleared by the caller after a pick, so the field empties between picks. */
  query: string
  onQuery: (query: string) => void
  /**
   * Hands focus back to the field after a pick, for a caller that takes several in one visit. A
   * caller that closes on the first pick leaves this off, so the keyboard does not come back up
   * over a sheet already on its way out.
   */
  keepFocus?: boolean
}) {
  const entries = useCatalog()
  const instruments = useInstruments() ?? NO_INSTRUMENTS
  const searchRef = useRef<SearchFieldHandle>(null)

  const matches = useMemo(
    () => (entries && query.trim() ? filterCatalog(entries, PICKER_FILTERS, query) : []),
    [entries, query],
  )
  const outcome = useMemo(
    () => (entries ? searchOutcome(entries, matches, query, true) : UNREAD),
    [entries, matches, query],
  )

  const pick = (entry: CatalogEntry) => {
    if (taken.has(entry.userTune.id)) return
    onPick(entry)
    if (keepFocus) searchRef.current?.focus()
  }

  const submit = () => {
    if (!entries) return
    // Every match counts here, the taken ones included, so Enter never creates a tune whose title
    // already exists; a lone taken match then simply does nothing.
    const action = enterAction(query, matches, outcome)
    if (action.kind === 'open') {
      const entry = matches.find((match) => match.tune.id === action.tuneId)
      if (entry) pick(entry)
    } else if (action.kind === 'create') {
      onCreate(action.title)
    } else {
      searchRef.current?.blur()
    }
  }

  return (
    <>
      <div className="px-2 pt-2">
        <SearchField ref={searchRef} name={name} value={query} onInput={onQuery} onEnter={submit} />
      </div>
      {matches.length > 0 || outcome.kind === 'create' ? (
        <Group>
          {matches.slice(0, MAX_RESULTS).map((entry) =>
            taken.has(entry.userTune.id) ? (
              <TuneItem
                key={entry.userTune.id}
                entry={entry}
                instruments={instruments}
                // Holds the width the offered rows give their add icon, so every title in the
                // results starts on the same line.
                start={<span slot="start" aria-hidden="true" className="size-6" />}
                end={<IonNote className="type-footnote">{takenLabel}</IonNote>}
              />
            ) : (
              <IonItem key={entry.userTune.id} button detail={false} onClick={() => pick(entry)}>
                {/* ion-item copies an aria-label onto its native button once, as it loads, and
                    takes it off the host, so a name written that way cannot follow the row it
                    labels. A line inside the button always says what the row now shows, and
                    the visible lines stay out of the name. Every picker searches archived tunes
                    on purpose, so the name says which ones they are. */}
                <span className="sr-only">
                  {entry.userTune.archived_at !== null
                    ? `${rowName(entry.tune.title)}, archived`
                    : rowName(entry.tune.title)}
                </span>
                <Plus
                  aria-hidden="true"
                  slot="start"
                  className="size-6 text-(--ion-color-primary)"
                />
                <TuneLines entry={entry} instruments={instruments} silent />
              </IonItem>
            ),
          )}
          {matches.length === 0 && outcome.kind === 'create' && !outcome.another ? (
            <IonItem lines="none">
              <IonLabel>
                <p className="type-footnote">{`No tune called "${outcome.title}"`}</p>
              </IonLabel>
            </IonItem>
          ) : null}
          {outcome.kind === 'create' ? (
            <IonItem button detail={false} lines="none" onClick={() => onCreate(outcome.title)}>
              <Plus aria-hidden="true" slot="start" className="size-6 text-(--ion-color-primary)" />
              <IonLabel color="primary">
                {outcome.another ? `Add another "${outcome.title}"` : `Add "${outcome.title}"`}
              </IonLabel>
            </IonItem>
          ) : null}
        </Group>
      ) : null}
    </>
  )
}
