import { Ellipsis, ListChecks, Music, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Key, Selection } from 'react-aria-components'
import { useNavigate, useParams } from 'react-router'
import { useDb } from '../../db/DbProvider'
import {
  ADD_TUNE,
  addOfferLabel,
  catalogEmpty,
  SEARCH_TUNES,
  SHOW_ARCHIVED,
  TUNE_LIST,
  SELECT_TUNES,
} from './catalogCopy'
import { CATALOG_SORT_OPTIONS } from './catalogSort'
import { ROW_FACETS, type CatalogEntry } from './filters'
import { useCatalogScreen } from './useCatalogScreen'
import { usePlayingTune } from '../player/usePlayingTune'
import { useStatusCounts } from './useStatusCounts'
import type { ScanViewOrigin } from '../scans/scanViewLog'
import { useBulkActionsWith, type SelectionContext } from '../selection/useBulkActionsWith'
import { deleteTunesQuestion } from '../tune/deleteTuneQuestion'
import { DELETE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { SORT, sortControlName, sortMenuChoices } from '../../ui/sortCopy'
import { useAction } from '../../ui/useAction'
import { destination } from '../../app/destinations'
import { sortCommand, useScreenCommand } from '../../app/screenCommands'
import { usePageShown } from '../../app/usePageShown'
import { useFrame } from '../../platform/frame'
import { useRowScanViewer } from '../scans/useRowScanViewer'
import { applySelection } from '../selection/applySelection'
import { BulkSheets, SelectionBar } from '../selection/SelectionBar'
import { useScreenSelection, useSelectionReturn } from '../selection/useScreenSelection'
import { ColumnTitle } from '../../app/ColumnTitle'
import { PaneBar } from '../../app/PaneBar'
import { ImportSheet } from '../import/ImportSheet'
import { IMPORT_TUNES } from '../import/importCopy'
import { useTuneFormLauncher } from '../tune/formLauncher'
import { useTuneActions } from '../tune/useTuneActions'
import { tunePick } from '../tune/tunePick'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorLine } from '../../ui/ErrorLine'
import { ListHeader } from '../../ui/ListHeader'
import { Menu, type MenuEntry } from '../../ui/Menu'
import { RowList } from '../../ui/RowList'
import { SearchField } from '../../ui/SearchField'
import { useSearchTarget } from '../keyboard/searchTarget'
import { useToast } from '../../ui/Toast'
import { CatalogFilterRow } from './CatalogFilterRow'
import { scopeTitle } from './scope'
import { HiddenMatch, SearchOffer } from './SearchOffer'
import { StatusTitle } from './StatusTitle'
import { TuneRow } from './TuneRow'
import { useHadContent } from '../../ui/useHadContent'

const CATALOG_CONTEXT: SelectionContext = { kind: 'catalog' }
const CATALOG_ROW: ScanViewOrigin = { context: 'row' }

const CATALOG = destination('catalog')

/** The catalog's list column: its verbs, search, count and sort, and the tune rows. */
export function CatalogScreen() {
  const db = useDb()
  const tuneActions = useTuneActions()
  const navigate = useNavigate()
  const { tuneId } = useParams()
  const frame = useFrame()
  const wide = frame === 'wide'
  const form = useTuneFormLauncher()
  const confirm = useConfirm()
  const toast = useToast()
  const { error, run } = useAction()
  const statusCounts = useStatusCounts()
  const playingTune = usePlayingTune()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useSearchTarget(searchRef)
  const [importing, setImporting] = useState(false)

  // The one row whose title morphs into the page title. A transition name must be unique on
  // the page, every other row's title would also move, and on wide the list stays beside the
  // page, so only a row opened off wide carries it.
  const [opening, setOpening] = useState<string | null>(null)
  const openTune = (id: string) => {
    setOpening(id)
    void navigate(`${CATALOG.root}/${id}`, { state: tunePick() })
  }
  const screen = useCatalogScreen({
    onOpenTune: openTune,
    onCreate: (title) => form.open({ source: 'search_offer', initialTitle: title }),
    barFacets: ROW_FACETS,
  })
  const {
    ready,
    entries,
    instruments,
    tunes,
    countLabel,
    counts,
    effectiveFilters,
    setFilters,
    filterError,
    facets,
    visibleFacets,
    missingOptions,
    sheet,
    query,
    setQuery,
    searchOutcome: outcome,
    submit,
    createFromSearch,
    sort,
    setSort,
    announcement,
    refreshQuery,
  } = screen
  const hadTunes = useHadContent(ready && tunes.length > 0)
  const hadNoTunes = useHadContent(ready && tunes.length === 0)
  const scans = useRowScanViewer(CATALOG_ROW)
  const visibleIds = useMemo(() => tunes.map((entry) => entry.tune.id), [tunes])
  const selection = useScreenSelection(visibleIds)
  const { moreRef, rowsRef, fromMore, fromRow, restore } = useSelectionReturn(selection)
  const selecting = selection.active
  const { isSelected } = selection.selection
  const selectedEntries = useMemo(
    () => tunes.filter((entry) => isSelected(entry.tune.id)),
    [tunes, isSelected],
  )
  const bulk = useBulkActionsWith({
    entries: selectedEntries,
    context: CATALOG_CONTEXT,
    onExit: selection.exit,
    confirm,
    toast: toast.show,
  })

  // Another screen can clear the search on its way here, such as a stats value opening the
  // catalog filtered by it, while this list stayed mounted.
  usePageShown(refreshQuery)

  const status = effectiveFilters.status
  const title = scopeTitle(CATALOG.label, status)
  const phone = frame === 'phone'

  const openFound = (id: string) => {
    screen.endSearch()
    openTune(id)
  }

  // Between tunes the page replaces the one before, so walking the rows with the arrows does
  // not leave an entry in history for every tune passed.
  const choose = (keys: 'all' | Set<Key>) => {
    if (keys === 'all') return
    const [key] = keys
    if (key === undefined || key === tuneId) return
    screen.endSearch()
    void navigate(`${CATALOG.root}/${String(key)}`, {
      replace: tuneId !== undefined,
      state: tunePick(),
    })
  }

  const confirmDelete = async (entry: CatalogEntry) => {
    const ok = await confirm({ ...(await deleteTunesQuestion(db, [entry])), action: DELETE })
    if (!ok) return
    // An open tune's page leaves on its own once the tune is gone.
    run(() => tuneActions.remove(entry.tune.id))
  }

  const more: MenuEntry[] = [
    { id: 'select', label: SELECT_TUNES, icon: ListChecks, onAction: fromMore },
    {
      id: 'archived',
      label: SHOW_ARCHIVED,
      checked: effectiveFilters.archived,
      onAction: () => void setFilters({ archived: !effectiveFilters.archived }),
    },
  ]

  // Off wide a tune page covers the list, so its commands go with it.
  const listShown = wide || tuneId === undefined
  useScreenCommand(
    { id: 'selectTunes', label: SELECT_TUNES, run: fromMore },
    listShown && !selecting,
  )
  useScreenCommand(
    sortCommand(CATALOG_SORT_OPTIONS, sort, setSort),
    listShown && !selecting && ready && tunes.length > 0,
  )

  const empty = catalogEmpty(entries.length, query, outcome)
  const ascending = !sort.descending

  return (
    <>
      {selecting ? (
        <SelectionBar selection={selection} actions={bulk} restoreFocus={restore} />
      ) : (
        <PaneBar
          title={title}
          trailing={
            <>
              <Button
                icon={Plus}
                label={ADD_TUNE}
                iconOnly
                onPress={() => form.open({ source: 'catalog' })}
              />
              <Menu
                label={MORE_ACTIONS}
                trigger={<Button ref={moreRef} icon={Ellipsis} label={MORE_ACTIONS} iconOnly />}
                items={more}
              />
            </>
          }
        />
      )}
      <ColumnTitle
        title={title}
        titleRef={titleRef}
        menu={
          phone ? (
            <StatusTitle
              status={status}
              counts={statusCounts}
              onChoose={(value) => void setFilters({ status: value })}
            />
          ) : undefined
        }
      />
      <div className="px-4 pb-2">
        <SearchField
          ref={searchRef}
          label={SEARCH_TUNES}
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            if (submit()?.kind === 'blur') searchRef.current?.blur()
          }}
        />
      </div>
      <CatalogFilterRow
        ready={ready}
        filters={effectiveFilters}
        facets={facets}
        visible={visibleFacets}
        missing={missingOptions}
        counts={counts}
        sheet={sheet}
        statusCounts={statusCounts}
        showsStatus={phone}
        title={titleRef}
        onChange={(patch) => void setFilters(patch)}
      />
      <ErrorLine error={filterError} place="bar" />
      <ErrorLine error={error} place="bar" />
      {ready && (
        <>
          {counts.all > 0 && (
            <ListHeader
              count={countLabel}
              sort={
                tunes.length === 0
                  ? undefined
                  : {
                      label: CATALOG_SORT_OPTIONS.labels[sort.sort],
                      ascending,
                      spoken: sortControlName(CATALOG_SORT_OPTIONS, sort),
                      menu: (trigger) => (
                        <Menu
                          label={SORT}
                          trigger={trigger}
                          choiceMode="single"
                          items={sortMenuChoices(CATALOG_SORT_OPTIONS, sort).map((choice) => ({
                            id: choice.sort,
                            label: choice.label,
                            description: choice.description,
                            checked: choice.checked,
                            onAction: () => setSort(choice.next),
                          }))}
                        />
                      ),
                    }
              }
            />
          )}
          {tunes.length === 0 ? (
            <EmptyState
              arriving={hadTunes}
              icon={Music}
              title={empty.title}
              hint={empty.hint}
              action={
                outcome.kind === 'create' ? (
                  <div className="flex flex-col items-center gap-2">
                    <HiddenMatch outcome={outcome} onOpen={openFound} />
                    <Button
                      variant="primary"
                      label={addOfferLabel(outcome)}
                      onPress={() => createFromSearch()}
                    />
                  </div>
                ) : empty.noTunes ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      label={ADD_TUNE}
                      onPress={() => form.open({ source: 'catalog' })}
                    />
                    <Button
                      variant="plain"
                      label={IMPORT_TUNES}
                      onPress={() => setImporting(true)}
                    />
                  </div>
                ) : null
              }
            />
          ) : (
            <div ref={rowsRef} className="contents">
              <RowList
                label={TUNE_LIST}
                arriving={hadNoTunes}
                {...(selecting
                  ? {
                      selectionMode: 'multiple',
                      selectionBehavior: 'toggle',
                      selectedKeys: new Set(selection.selected),
                      onSelectionChange: (keys: Selection) => applySelection(selection, keys),
                    }
                  : {
                      // Selection follows focus only once a tune is open, so tabbing into the
                      // list never opens one; until then Enter or a click opens a tune as the
                      // row's action, as `RowList` says.
                      selectionMode: wide && tuneId ? 'single' : 'none',
                      selectionBehavior: 'replace',
                      disallowEmptySelection: true,
                      selectedKeys: new Set(tuneId ? [tuneId] : []),
                      onSelectionChange: choose,
                      onAction: wide && tuneId ? undefined : (key: Key) => openFound(String(key)),
                    })}
              >
                {tunes.map((entry) => (
                  <TuneRow
                    key={entry.tune.id}
                    entry={entry}
                    instruments={instruments}
                    onEdit={() => form.open({ source: 'catalog', tuneId: entry.tune.id })}
                    onArchive={(archived) =>
                      run(() =>
                        tuneActions.archive(
                          { tuneId: entry.tune.id, userTuneId: entry.userTune.id },
                          archived,
                        ),
                      )
                    }
                    onDelete={() => void confirmDelete(entry)}
                    onSelect={() => fromRow(entry.tune.id)}
                    onViewScans={
                      screen.scanTunes.has(entry.tune.id)
                        ? () => scans.open(entry.tune.id)
                        : undefined
                    }
                    selecting={selecting}
                    opening={!wide && entry.tune.id === opening}
                    playing={entry.tune.id === playingTune}
                  />
                ))}
              </RowList>
              <HiddenMatch outcome={outcome} onOpen={openFound} />
              <SearchOffer outcome={outcome} onCreate={createFromSearch} />
            </div>
          )}
        </>
      )}
      <BulkSheets
        actions={bulk}
        entries={selectedEntries}
        context={CATALOG_CONTEXT}
        instruments={instruments}
      />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <ImportSheet open={importing} entry="empty_catalog" onClosed={() => setImporting(false)} />
      {scans.viewer}
    </>
  )
}
