import { useIonRouter } from '@ionic/react'
import { AudioLines } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { SyncRefresher } from '../../sync/SyncRefresher'
import { EmptyState } from '../../ui/EmptyState'
import { FiltersButton } from '../../ui/FiltersButton'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { ListHeader } from '../../ui/ListHeader'
import { Screen } from '../../ui/Screen'
import { SearchField, type SearchFieldHandle } from '../../ui/SearchField'
import { SortMenuButton } from '../../ui/SortMenu'
import { messageFor } from '../../ui/useAction'
import { useRowArrowKeys, useSearchShortcut } from '../../ui/useShortcut'
import { NOTHING_MATCHES } from '../catalog/CatalogPage'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import { addAudioFiles } from './addAudioFiles'
import { AddToTuneSheet } from './AddToTuneSheet'
import { arrangedCount, arrangeRecordings, recordingCountLabel } from './arrangeRecordings'
import { RecordingItem } from './RecordingItem'
import { RecordingsFilters } from './RecordingsFilters'
import { RecordingsFilterSheet } from './RecordingsFilterSheet'
import { retryKind } from './recordingRow'
import { setRecordingsSort, useRecordingsSort } from './recordingsSort'
import { EditRecordingSheet } from './EditRecordingSheet'
import { RECORDING_SORT_OPTIONS } from './sortCopy'
import { Storage } from './Storage'
import { TuneLabelLine } from './TuneLabelLine'
import { UploadButton } from './UploadButton'
import { useRecordingActions } from './useRecordingActions'
import { useRecordingsOrigin } from './useRecordingsOrigin'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

export const NO_RECORDINGS_TITLE = 'No recordings yet'
export const NO_RECORDINGS_HINT = 'Use the record button to make one, or upload an audio file.'
export const SEARCH_RECORDINGS = 'Search recordings'
export const FILED_HEADER = 'Filed'
export const UNFILED_HEADER = 'Unfiled'
export const FILTERS_DISABLED_REASON = 'All recordings are yours'

/** Import sources the user holds. */
function heldOrigins(views: readonly RecordingView[]): string[] {
  const held = new Set(views.map((view) => view.recording.origin))
  held.delete('own')
  return [...held]
}

export function RecordingsPage() {
  const db = useDb()
  const loadedViews = useRecordingsWithFiles()
  const [choice, choose] = useRecordingsOrigin()
  // One Screen whether or not the data has loaded: swapping the IonPage element after the
  // router outlet has mounted it would leave the outlet holding a detached page.
  const ready = loadedViews !== undefined && choice !== undefined
  const router = useIonRouter()
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [editing, setEditing] = useState<RecordingView | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const openTune = (tuneId: string) => router.push(`/recordings/${tuneId}`, 'forward', 'push')
  const openTuneOf = ({ tuneId }: RecordingView) => (tuneId ? () => openTune(tuneId) : undefined)
  const { error, setUploadError, retry, actionsFor } = useRecordingActions({
    onEdit: setEditing,
    onAddToTune: setFiling,
    onOpenTune: (view) => openTuneOf(view)?.(),
  })
  const groupsRef = useRef<HTMLDivElement>(null)
  useRowArrowKeys(groupsRef)
  const searchRef = useRef<SearchFieldHandle>(null)
  useSearchShortcut(useCallback(() => searchRef.current?.focus(), []))

  const imported = useMemo(() => (loadedViews ? heldOrigins(loadedViews) : []), [loadedViews])
  const shown = useMemo(() => {
    if (!loadedViews) return []
    return choice === undefined || choice === 'all'
      ? loadedViews
      : loadedViews.filter((view) => view.recording.origin === choice)
  }, [loadedViews, choice])

  const filterSet = choice !== undefined && choice !== 'all'
  // Nothing to tell apart until a recording comes from somewhere else; a set filter still needs
  // its way back to All. With no recordings the empty state explains the screen, so the
  // disabled control says nothing.
  const filtersDisabled = !ready || (imported.length === 0 && !filterSet)
  const filtersReason = ready && loadedViews.length > 0 ? FILTERS_DISABLED_REASON : undefined

  const sort = useRecordingsSort()
  const [query, setQuery] = useState(() => readSearchQuery('recordings'))
  const changeQuery = (value: string) => {
    setQuery(value)
    writeSearchQuery('recordings', value)
  }
  const arrangement = useMemo(() => arrangeRecordings(shown, sort, query), [shown, sort, query])
  const { unfiled, filed } = arrangement
  const filedEmpty = filed.kind === 'flat' ? filed.views.length === 0 : filed.groups.length === 0
  const listed = arrangedCount(arrangement)

  const item = (view: RecordingView, extra: { headingLevel?: 4; onOpenTune?: () => void }) => (
    <RecordingItem
      key={view.recording.id}
      view={view}
      actions={actionsFor(view)}
      error={retryKind(view) === 'upload' ? view.file?.error : null}
      tuneNamedAbove
      sort={sort.sort}
      onRetry={(kind) => retry(view, kind)}
      {...extra}
    />
  )

  const addDropped = (files: File[]) => {
    setUploadError(null)
    addAudioFiles(db, files, null).catch((caught: unknown) => setUploadError(messageFor(caught)))
  }

  return (
    <Screen
      title="Recordings"
      level="top"
      grouped
      end={<UploadButton tuneId={null} onError={setUploadError} />}
      search={
        <SearchField
          ref={searchRef}
          name={SEARCH_RECORDINGS}
          value={query}
          onInput={changeQuery}
          onEnter={() => searchRef.current?.blur()}
        />
      }
      searchEnd={
        <FiltersButton
          setCount={filterSet ? 1 : 0}
          disabled={filtersDisabled}
          disabledReason={filtersReason}
          onOpen={() => setFiltersOpen(true)}
        />
      }
      refresher={<SyncRefresher />}
      onDropFiles={addDropped}
    >
      <h1 className="sr-only">Recordings</h1>
      {ready ? <RecordingsFilters choice={choice} onChange={choose} /> : null}
      <Storage />
      {ready ? (
        <>
          {loadedViews.length > 0 ? (
            <ListHeader
              inset
              count={recordingCountLabel(listed, loadedViews.length)}
              sort={
                listed === 0 ? undefined : (
                  <SortMenuButton
                    options={RECORDING_SORT_OPTIONS}
                    choice={sort}
                    onChange={setRecordingsSort}
                  />
                )
              }
            />
          ) : null}
          {loadedViews.length === 0 ? (
            <EmptyState icon={AudioLines} title={NO_RECORDINGS_TITLE} hint={NO_RECORDINGS_HINT} />
          ) : listed === 0 ? (
            <EmptyState icon={AudioLines} title={NOTHING_MATCHES} />
          ) : null}
          {/* One container across both lists, so the arrow keys walk the whole screen rather
              than stopping at the last row of a list. */}
          <div ref={groupsRef}>
            {unfiled.length > 0 ? (
              <Group header={UNFILED_HEADER} name={UNFILED_HEADER}>
                {unfiled.map((view) => item(view, {}))}
              </Group>
            ) : null}
            {filedEmpty ? null : (
              <Group header={FILED_HEADER} name={FILED_HEADER}>
                {filed.kind === 'flat'
                  ? filed.views.map((view) => item(view, { onOpenTune: openTuneOf(view) }))
                  : filed.groups.flatMap((group) => [
                      <TuneLabelLine
                        key={`tune:${group.tuneId}`}
                        title={group.tuneTitle}
                        onOpen={() => openTune(group.tuneId)}
                      />,
                      ...group.views.map((view) => item(view, { headingLevel: 4 })),
                    ])}
              </Group>
            )}
          </div>
          {error ? <InlineError className="px-(--form-inset) py-2">{error}</InlineError> : null}
          <RecordingsFilterSheet
            open={filtersOpen}
            choice={choice}
            origins={imported}
            onChange={choose}
            onClose={() => setFiltersOpen(false)}
          />
        </>
      ) : null}
      <EditRecordingSheet view={editing} onClose={() => setEditing(null)} />
      <AddToTuneSheet view={filing} onClose={() => setFiling(null)} />
    </Screen>
  )
}
