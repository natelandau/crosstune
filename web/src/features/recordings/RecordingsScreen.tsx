import { AudioLines, ChevronRight, SlidersHorizontal, Upload, X } from 'lucide-react'
import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { NOTHING_MATCHES } from '../catalog/catalogCopy'
import type { SortChoice } from './arrangeRecordings'
import { retryKind, sourceLabel } from './recordingRow'
import {
  FILED_HEADER,
  NO_RECORDINGS_HINT,
  NO_RECORDINGS_TITLE,
  SEARCH_RECORDINGS,
  UNFILED_HEADER,
  UPLOAD_AUDIO,
} from './recordingsCopy'
import { RECORDING_SORT_OPTIONS } from './sortCopy'
import type { RecordingView } from './useRecordings'
import { useRecordingsScreen } from './useRecordingsScreen'
import { RECORDINGS_ROW_ORIGIN } from '../player/playLog'
import { FILTERS, filtersLabel, removeFilterLabel } from '../../ui/filterCopy'
import { SORT, sortControlName, sortMenuChoices } from '../../ui/sortCopy'
import { useFileDrop } from '../../ui/useFileDrop'
import { useFocusFallback } from '../../ui/useFocusFallback'
import { destination } from '../../app/destinations'
import { sortCommand, useScreenCommand } from '../../app/screenCommands'
import { useStampedDensity } from '../../platform/density'
import { useFrame } from '../../platform/frame'
import { ColumnTitle } from '../../app/ColumnTitle'
import { PaneBar } from '../../app/PaneBar'
import { MediaList, RecordingRow } from '../tune/MediaRow'
import { tunePick } from '../tune/tunePick'
import { Button } from '../../ui/Button'
import { Capsule } from '../../ui/Capsule'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorLine } from '../../ui/ErrorLine'
import { FilterRow } from '../../ui/FilterRow'
import { ListHeader } from '../../ui/ListHeader'
import { Menu } from '../../ui/Menu'
import { SearchField } from '../../ui/SearchField'
import { useSearchTarget } from '../keyboard/searchTarget'
import { AddToTuneSheet } from './AddToTuneSheet'
import { DropOverlay } from './DropOverlay'
import { EditRecordingSheet } from './EditRecordingSheet'
import { RecordingsFilterSheet } from './RecordingsFilterSheet'
import { StorageSummary } from './StorageSummary'
import { useHadContent } from '../../ui/useHadContent'

const RECORDINGS = destination('recordings')

/** The name of the row that holds the Recordings filter control and its set source. */
export const RECORDINGS_FILTER_ROW = 'Filter recordings'

const tunePath = (tuneId: string) => `${RECORDINGS.root}/${tuneId}`

/**
 * Every recording, unfiled first and then filed, with Upload as the verb, search and the
 * source filter to narrow, and the account's storage at the foot. Files dropped on the column
 * on pointer import as unfiled recordings.
 */
export function RecordingsScreen() {
  const navigate = useNavigate()
  const { tuneId: openTuneId } = useParams()
  const pointer = useStampedDensity() === 'pointer'
  // Between tunes the page replaces the one before, so opening one tune after another does
  // not leave an entry in history for each.
  const openTune = (tuneId: string) => {
    if (tuneId === openTuneId) return
    void navigate(tunePath(tuneId), {
      replace: openTuneId !== undefined,
      state: tunePick(),
    })
  }
  const screen = useRecordingsScreen({ confirm: useConfirm(), onOpenTune: openTune })
  const { ready, unfiled, filed, sort, actionsFor, retry, error } = screen
  const hadRecordings = useHadContent(ready && screen.listed > 0)
  const hadNoRecordings = useHadContent(ready && screen.listed === 0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useSearchTarget(searchRef)
  const filtersClosed = useFocusFallback(titleRef, {
    controls: { filters: screen.showsFilters, token: screen.filterSet },
    trigger: screen.showsFilters,
    sheetOpen: filtersOpen,
  })
  // Off wide a tune page covers the list, so its Sort by goes with it.
  const listShown = useFrame() === 'wide' || openTuneId === undefined
  useScreenCommand(
    sortCommand(RECORDING_SORT_OPTIONS, sort, screen.setSort),
    listShown && ready && screen.listed > 0,
  )
  const drop = useFileDrop(pointer ? (files) => void screen.importFiles(files) : undefined)

  const row = (view: RecordingView, { grouped }: { grouped: boolean }) => (
    <RecordingRow
      key={view.recording.id}
      row={{
        view,
        pinned: false,
        actions: actionsFor(view),
        error: retryKind(view) === 'upload' ? view.file?.error : null,
      }}
      tuneNamedAbove={grouped}
      sort={sort.sort}
      onOpenTune={!grouped && view.tuneId ? () => openTune(view.tuneId!) : undefined}
      onRetry={(kind) => retry(view, kind)}
      playOrigin={RECORDINGS_ROW_ORIGIN}
    />
  )

  return (
    <div {...drop.handlers} className="flex min-h-full flex-col">
      <PaneBar
        title={RECORDINGS.label}
        trailing={<UploadControl onFiles={(files) => void screen.importFiles(files)} />}
      />
      <DropOverlay shown={drop.over} />
      <ColumnTitle title={RECORDINGS.label} titleRef={titleRef} />
      <div className="px-4 pb-2">
        <SearchField
          ref={searchRef}
          label={SEARCH_RECORDINGS}
          value={screen.query}
          onChange={screen.setQuery}
        />
      </div>
      {screen.showsFilters && (
        <FilterRow label={RECORDINGS_FILTER_ROW}>
          <Capsule
            label={filtersLabel(screen.filterSet ? 1 : 0)}
            set={screen.filterSet}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            onPress={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {FILTERS}
            {screen.filterSet && <span className="t-num">1</span>}
          </Capsule>
          {screen.filterSet && (
            <Capsule
              label={removeFilterLabel(sourceLabel(screen.source))}
              set
              onPress={() => screen.setSource('all')}
            >
              {sourceLabel(screen.source)}
              <X className="size-3.5" aria-hidden />
            </Capsule>
          )}
        </FilterRow>
      )}
      <ErrorLine error={error} place="bar" />
      {ready && (
        <>
          {screen.total > 0 && (
            <ListHeader
              count={screen.countLabel}
              sort={screen.listed === 0 ? undefined : sortControl(sort, screen.setSort)}
            />
          )}
          {screen.total === 0 ? (
            <EmptyState
              arriving={hadRecordings}
              icon={AudioLines}
              title={NO_RECORDINGS_TITLE}
              hint={NO_RECORDINGS_HINT}
            />
          ) : screen.listed === 0 ? (
            <EmptyState arriving={hadRecordings} icon={AudioLines} title={NOTHING_MATCHES} />
          ) : (
            <div className={`px-4 ${hadNoRecordings ? 'arrive' : ''}`}>
              {unfiled.length > 0 && (
                <Group title={UNFILED_HEADER}>
                  {unfiled.map((view) => row(view, { grouped: false }))}
                </Group>
              )}
              {filed.kind === 'flat'
                ? filed.views.length > 0 && (
                    <Group title={FILED_HEADER}>
                      {filed.views.map((view) => row(view, { grouped: false }))}
                    </Group>
                  )
                : filed.groups.map((group) => (
                    <Group
                      key={group.tuneId}
                      title={group.tuneTitle}
                      heading={
                        <TuneHeading
                          tuneId={group.tuneId}
                          title={group.tuneTitle}
                          onOpen={openTune}
                        />
                      }
                    >
                      {group.views.map((view) => row(view, { grouped: true }))}
                    </Group>
                  ))}
            </div>
          )}
          {screen.total > 0 && <StorageSummary />}
          <RecordingsFilterSheet
            isOpen={filtersOpen}
            onOpenChange={setFiltersOpen}
            choice={screen.source}
            origins={screen.origins}
            onChange={screen.setSource}
            onClosed={filtersClosed}
          />
        </>
      )}
      <EditRecordingSheet view={screen.editing} onClose={() => screen.setEditing(null)} />
      <AddToTuneSheet
        source="recordings_list"
        view={screen.filing}
        onClose={() => screen.setFiling(null)}
      />
    </div>
  )
}

function sortControl(sort: SortChoice, setSort: (choice: SortChoice) => void) {
  return {
    label: RECORDING_SORT_OPTIONS.labels[sort.sort],
    ascending: !sort.descending,
    spoken: sortControlName(RECORDING_SORT_OPTIONS, sort),
    menu: (trigger: Parameters<typeof Menu>[0]['trigger']) => (
      <Menu
        label={SORT}
        trigger={trigger}
        choiceMode="single"
        items={sortMenuChoices(RECORDING_SORT_OPTIONS, sort).map((choice) => ({
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

/** One group of recordings: a plain heading in the section heading role, then its rows. */
function Group({
  title,
  heading,
  children,
}: {
  title: string
  /** Stands in for the plain title, such as a tune's name that opens the tune. */
  heading?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="pt-6 first:pt-2">
      <div className="flex min-h-11 items-center">
        <h2 id={id} className="t-heading min-w-0">
          {heading ?? title}
        </h2>
      </div>
      <MediaList label={title}>{children}</MediaList>
    </section>
  )
}

/** A tune group's name, which opens the tune. */
function TuneHeading({
  tuneId,
  title,
  onOpen,
}: {
  tuneId: string
  title: string
  onOpen: (tuneId: string) => void
}) {
  // The link keeps its address for a new tab or window; a plain click opens it in place.
  const open = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(tuneId)
  }
  return (
    <Link
      to={tunePath(tuneId)}
      onClick={open}
      className="inline-flex max-w-full items-center gap-1"
    >
      <span className="truncate">{title}</span>
      <ChevronRight className="text-ink-2 size-5 shrink-0" aria-hidden />
    </Link>
  )
}

/** Upload, the screen's Add verb: it opens the system picker for audio files. */
function UploadControl({ onFiles }: { onFiles: (files: File[]) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button icon={Upload} label={UPLOAD_AUDIO} iconOnly onPress={() => picker.current?.click()} />
      {/* The native picker cannot be styled, so it hides behind the button, out of the tab
          order and the tree, which the button already names. */}
      <input
        ref={picker}
        type="file"
        accept="audio/*"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </>
  )
}
