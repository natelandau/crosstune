import { useMemo, useRef } from 'react'
import type { Instrument } from '../../api/vocabulary'
import type { CatalogEntry } from '../../db/types'
import { DONE } from '../../ui/confirmCopy'
import { ErrorLine } from '../../ui/ErrorLine'
import { ButtonRow } from '../../ui/form/ButtonRow'
import { Group } from '../../ui/form/Group'
import { RowList } from '../../ui/RowList'
import { SearchField } from '../../ui/SearchField'
import { Sheet } from '../../ui/Sheet'
import { PickGlyph } from '../../ui/PickGlyph'
import { useInstruments } from '../settings/useInstruments'
import { AddTypedTitle } from './AddTypedTitle'
import { pickRowName, SEARCH_TUNES, TUNE_LIST } from './catalogCopy'
import { enterAction } from './searchIntent'
import { listCatalog } from './tuneMatches'
import { TuneRowView } from './TuneRow'
import type { TuneMatches } from './useTuneMatches'

// A row shows no tunings until the settings row is read, rather than the results waiting on it.
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

/** How many tunes one visit to the picker takes. */
export type TunePickerSelection =
  | {
      /** A pick or a new tune closes the sheet. */
      mode: 'single'
      /**
       * Above the search while a tune is chosen: a row under the sheet's title whose button
       * clears the choice and closes.
       */
      clear?: { label: string; onPress: () => void }
    }
  | {
      /**
       * The sheet stays open and the search keeps focus, so several go in one visit. A taken
       * tune stays in the results with a check; what a press on it does is the caller's.
       */
      mode: 'multiple'
      /** The user tune ids already taken. */
      taken: ReadonlySet<string>
    }

/**
 * The one sheet that searches the catalog for a tune: the field, the whole catalog A to Z until
 * something is typed, then every match, and the row that adds the typed title
 * as a tune. Picks apply at once, so Done alone closes it.
 */
export function TunePickerSheet({
  title,
  isOpen,
  onOpenChange,
  onClosed,
  selection,
  search,
  onPick,
  onCreate,
  rowName,
  emptyHint,
  error,
}: {
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Once the sheet has finished animating away. */
  onClosed?: () => void
  selection: TunePickerSelection
  /**
   * The caller's query and its reading of it, so the caller can reset the query and pause the
   * catalog read while the sheet is closed.
   */
  search: { query: string; setQuery: (query: string) => void; matches: TuneMatches }
  onPick: (entry: CatalogEntry) => void
  onCreate: (title: string) => void
  /** The name of a row by what a press does, such as "Add Forked Deer" or "Remove Forked Deer". */
  rowName: (title: string, taken: boolean) => string
  /** Shown in place of the list while the query is blank and the catalog holds no tune. */
  emptyHint?: string
  error?: string | null
}) {
  const instruments = useInstruments() ?? NO_INSTRUMENTS
  const searchRef = useRef<HTMLInputElement>(null)
  const { query, setQuery } = search
  const { entries, matches, outcome } = search.matches
  const idle = !query.trim()
  const multiple = selection.mode === 'multiple'
  const taken = multiple ? selection.taken : undefined
  const clear = multiple ? undefined : selection.clear
  // A blank query lists the whole catalog; a typed one, every match. Either can run long, so the
  // rows are windowed.
  const shown = useMemo(
    () => (idle ? (entries ? listCatalog(entries) : []) : matches),
    [idle, entries, matches],
  )
  const isTaken = (entry: CatalogEntry) => taken?.has(entry.userTune.id) ?? false

  const pick = (entry: CatalogEntry) => {
    onPick(entry)
    if (multiple) searchRef.current?.focus()
    else onOpenChange(false)
  }

  const create = (typed: string) => {
    onCreate(typed)
    if (!multiple) onOpenChange(false)
  }

  const submit = () => {
    if (!entries) return
    // Every match counts, the taken ones included, so Enter never creates a tune whose title
    // already exists.
    const action = enterAction(query, matches, outcome)
    if (action.kind === 'open') {
      // Enter only picks: a lone taken match stays taken.
      const entry = matches.find((match) => match.tune.id === action.tuneId)
      if (entry && !isTaken(entry)) pick(entry)
    } else if (action.kind === 'create') create(action.title)
    else searchRef.current?.blur()
  }

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClosed={onClosed}
      title={title}
      // Several picks in one visit want the room of the full height.
      height={multiple ? 'full' : 'part'}
      cancel={null}
      primary={{ label: DONE, onPress: () => onOpenChange(false) }}
    >
      {clear && (
        <Group>
          <ButtonRow
            title={title}
            button={{
              label: clear.label,
              variant: 'destructive',
              onPress: () => {
                clear.onPress()
                onOpenChange(false)
              },
            }}
          />
        </Group>
      )}
      <div className="px-4 pt-2 pb-2">
        <SearchField
          ref={searchRef}
          label={SEARCH_TUNES}
          value={query}
          onChange={setQuery}
          onSubmit={submit}
        />
      </div>
      <ErrorLine error={error} place="bar" />
      {idle && entries?.length === 0 && emptyHint && (
        <p className="t-secondary text-secondary px-4 pt-2">{emptyHint}</p>
      )}
      {shown.length > 0 && (
        <RowList
          // The catalog and a search's matches each get their own list, so typing never carries the
          // catalog's scroll position or row measurements into the matches.
          key={idle ? 'catalog' : 'matches'}
          label={TUNE_LIST}
          virtualized="own"
          onAction={(key) => {
            const entry = shown.find((match) => match.userTune.id === key)
            if (entry) pick(entry)
          }}
        >
          {shown.map((entry) => {
            const inList = isTaken(entry)
            return (
              <TuneRowView
                key={entry.userTune.id}
                id={entry.userTune.id}
                entry={entry}
                instruments={instruments}
                end={<PickGlyph added={inList} />}
                showsStatus={!multiple}
                name={pickRowName(
                  rowName(entry.tune.title, inList),
                  entry.userTune.archived_at !== null,
                )}
              />
            )
          })}
        </RowList>
      )}
      {!idle && <AddTypedTitle outcome={outcome} onCreate={create} />}
    </Sheet>
  )
}
