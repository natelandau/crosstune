import { BookOpen, Ellipsis, Plus } from 'lucide-react'
import {
  addTransitionType,
  startTransition,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
  type ReactNode,
} from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useLocation } from 'react-router'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { lyricLines } from '../lyrics/lyricLines'
import { Verses } from '../lyrics/Verses'
import { NEW_RECORDING } from '../capture/recordCopy'
import type { RecordingView } from '../recordings/useRecordings'
import { ADD_RECORDING } from './tuneMediaCopy'
import {
  ADD_LYRICS,
  ADD_LYRICS_TEXT,
  ADD_SCAN,
  ADD_SCAN_TEXT,
  ADDING_SCAN,
  ADD_TO_LIST_TITLE,
  ADD_TO_TUNE,
  EDIT_LYRICS,
  LYRICS_SECTION,
  NOTES_SECTION,
  OPEN_LYRICS,
  RECORDINGS_SECTION,
  SCANS_SECTION,
} from './tuneScreenCopy'
import { useTuneMedia } from './useTuneMedia'
import { RecordingsLine } from './RecordingsLine'
import { recordingsPlayable } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useTuneScreen, type TuneScreenData } from './useTuneScreen'
import { DELETING, EDIT } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { useLeaveTo } from '../../layout/backHistory'
import { FindRecordingsSheet } from '../links/FindRecordingsSheet'
import { PasteLinkSheet } from '../links/PasteLinkSheet'
import { LyricsReader } from '../lyrics/LyricsReader'
import { useFrame } from '../../platform/frame'
import { EditRecordingSheet } from '../recordings/EditRecordingSheet'
import { ListPickerSheet } from '../selection/ListPickerSheet'
import { useDetailPage } from '../../layout/Columns'
import { BackLink, PaneBar } from '../../layout/PaneBar'
import { RECORD_UNAVAILABLE, useRecordLauncher } from '../../app/recordLauncher'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { useToast } from '../../ui/Toast'
import { ErrorLine } from '../../ui/ErrorLine'
import { Menu } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { useElementSize } from '../../ui/useElementSize'
import { LISTS_GROUP } from './attributeCopy'
import { attributesLayout, headerGutter } from './attributesLayout'
import { takeFresh } from './freshTune'
import { useTuneFormLauncher } from './formLauncher'
import { LinkRow, MediaList, RecordingRow } from './MediaRow'
import { NotesField } from './NotesField'
import { FirstRecordingCard } from './FirstRecordingCard'
import { PageSection } from '../../ui/PageSection'
import { TuneHeader } from './TuneHeader'
import { AddedLine, TuneAttributes, TuneLists } from './TuneAttributes'
import { isQuietPick } from './tunePick'
import { useTuneScans, type TuneScansParts } from './useTuneScans'
import { TuneActionButtons } from './TuneActionButtons'
import { readTuneTitle, rememberTuneTitle } from './tuneTitle'
import { TINT_HOVER } from '../../ui/press'

const NO_RECORDINGS: readonly RecordingView[] = []
const NO_LINKS: readonly LocalRecordingLink[] = []

/**
 * One tune as a document, wherever it opened: the catalog, a list, recordings, or stats. Back
 * returns to `parent`, named `parentLabel`, and the page leaves for it once the tune is gone,
 * whether this page deleted it or another device did.
 *
 * Moving to another tune keeps the page on screen until the next one has read, so the column
 * never goes blank; the next page reads behind it, hidden, and replaces it in one step.
 */
export function TunePage({
  tuneId,
  parent,
  parentLabel,
}: {
  tuneId: string
  parent: string
  parentLabel: string
}) {
  const db = useDb()
  const wide = useFrame() === 'wide'
  // On phone and split the page waits for its title before it shows, so it arrives with the
  // heading the row title morphs into, and the list stays until then. Wide holds the page
  // before it on its own, below, and its list keeps the keyboard while a tune reads.
  const knownTitle = wide ? undefined : use(readTuneTitle(db, tuneId))
  const [shown, setShown] = useState(tuneId)
  const waiting = shown !== tuneId
  useDetailPage(shown)
  // React holds every later commit while a view transition runs, so a tune picked from the
  // keyboard on wide swaps in at once, and the next arrow press acts on it.
  const { state } = useLocation()
  const quiet = wide && isQuietPick(state)
  const reveal = useMemo(
    () => () => {
      // Nothing to swap. A swap-typed transition left pending lends its type to a later
      // commit, and the real swap then commits without it and never cross-fades.
      if (!waiting) return
      if (quiet) setShown(tuneId)
      else
        startTransition(() => {
          addTransitionType(SWAP)
          setShown(tuneId)
        })
    },
    [quiet, tuneId, waiting],
  )
  // One keyed list, so the page held on screen keeps its state while the next one reads.
  const documents = waiting ? [shown, tuneId] : [tuneId]
  // Measured here rather than in a page, since a page reading behind another is hidden and
  // has no width.
  const root = useRef<HTMLDivElement>(null)
  const layout = attributesLayout(useElementSize(root).width)
  return (
    // On phone and split a page pushes in over the list; on wide it fades in beside it, and a
    // swap to the next tune cross-fades. Any other change, including the next page mounting
    // hidden, starts no transition. Leaving never animates, so Back is a plain swap.
    <ViewTransition
      enter={quiet ? 'none' : wide ? 'tune-in' : 'push-in'}
      update={{ [SWAP]: 'tune-swap', default: 'none' }}
      exit="none"
      default="none"
    >
      <div ref={root}>
        {documents.map((id) =>
          id === tuneId ? (
            <TuneDocument
              key={id}
              tuneId={id}
              parent={parent}
              parentLabel={parentLabel}
              knownTitle={knownTitle}
              layout={layout}
              current
              hidden={waiting}
              onRead={reveal}
            />
          ) : (
            <TuneDocument
              key={id}
              tuneId={id}
              parent={parent}
              parentLabel={parentLabel}
              layout={layout}
              current={false}
              onRead={noop}
            />
          ),
        )}
      </div>
    </ViewTransition>
  )
}

const SWAP = 'tune-swap'
const noop = () => {}

function TuneDocument({
  tuneId,
  parent,
  parentLabel,
  layout,
  current,
  knownTitle,
  hidden = false,
  onRead,
}: {
  tuneId: string
  parent: string
  parentLabel: string
  /** The attributes beside the content as a column, or above it as a card. */
  layout: 'column' | 'card'
  /** True for the page of the tune the address names; false for one held while it reads. */
  current: boolean
  /** The title read before the page showed, for its heading until the attributes read. */
  knownTitle?: string | null
  hidden?: boolean
  /** Runs once the tune has read, or turned out to be gone. */
  onRead: () => void
}) {
  const db = useDb()
  const confirm = useConfirm()
  const form = useTuneFormLauncher()
  const record = useRecordLauncher()
  const leaveTo = useLeaveTo()
  const leave = () => leaveTo(parent)
  const screen = useTuneScreen(tuneId, { confirm, leave })
  const media = useTuneMedia(tuneId, {
    recordings: screen.recordings ?? NO_RECORDINGS,
    links: screen.tune?.links ?? NO_LINKS,
    confirm,
    startRecording: record.start,
  })
  const scans = useTuneScans(tuneId)
  const { ready, missing, attributes, deletingName } = screen
  useUndoWithdrawn(
    tuneId,
    !media.empty ||
      scans.has ||
      screen.inLists.length > 0 ||
      Boolean(screen.notes?.trim()) ||
      (attributes?.hasLyrics ?? false),
  )
  const [picking, setPicking] = useState(false)
  const [reading, setReading] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)

  useEffect(() => {
    if (ready || missing) onRead()
  }, [ready, missing, onRead])

  const readTitle = attributes?.title
  useEffect(() => {
    if (readTitle !== undefined) rememberTuneTitle(db, tuneId, readTitle)
  }, [db, tuneId, readTitle])

  // A held page whose tune went away stays until the next page replaces it.
  useEffect(() => {
    if (current && missing) leaveTo(parent)
  }, [current, missing, leaveTo, parent])

  const shownAttributes = ready && !deletingName ? attributes : null
  const title = shownAttributes?.title ?? deletingName ?? knownTitle ?? undefined
  const editAll = () => form.open({ tuneId })
  const addToList = () => setPicking(true)
  const more = menuEntries(screen.menuFor({ onAddToList: addToList, onEditAll: editAll }))
  const view = shownAttributes ? screen.tune : undefined
  const column = layout === 'column'
  // Off the phone More is the tune's own control on its title row, whichever way the attributes show.
  const moreOnTitle = useFrame() !== 'phone'
  const gutter = headerGutter(layout)
  const moreMenu = shownAttributes && (
    <Menu
      label={MORE_ACTIONS}
      trigger={<Button icon={Ellipsis} label={MORE_ACTIONS} iconOnly />}
      items={more}
    />
  )
  const readLyrics = () => setReading(true)

  const attributesPanel = view && screen.instruments && (
    <TuneAttributes
      view={view}
      instruments={screen.instruments}
      inLists={screen.inLists}
      createdAt={view.tune.created_at}
      layout={layout}
      onAddToList={addToList}
    />
  )
  const sections = shownAttributes && (
    <TuneSections
      tuneId={tuneId}
      screen={screen}
      media={media}
      scans={scans}
      recordAvailable={record.available}
      onRecord={() => record.start({ tuneId, source: 'tune' })}
      onEditLyrics={() => form.open({ tuneId, focus: 'lyrics' })}
      onReadLyrics={readLyrics}
      lyricsOpen={lyricsOpen}
      onLyricsOpenChange={setLyricsOpen}
      lists={
        !column &&
        view && (
          <>
            <PageSection title={LISTS_GROUP}>
              <TuneLists inLists={screen.inLists} onAddToList={addToList} />
            </PageSection>
            {/* A hairline, unlike between sections, so the date reads as the tune's, not the lists'. */}
            <AddedLine
              createdAt={view.tune.created_at}
              className="border-default mt-8 border-t pt-3"
            />
          </>
        )
      }
    />
  )

  return (
    <div hidden={hidden} inert={hidden}>
      <PaneBar
        title={title}
        leading={<BackLink to={parent} label={parentLabel} />}
        trailing={!moreOnTitle && moreMenu}
      />
      <article>
        <TuneHeader
          tuneId={tuneId}
          view={view}
          attributes={shownAttributes}
          title={title}
          active={!hidden}
          gutter={gutter}
          more={moreOnTitle ? moreMenu : undefined}
          actions={
            <TuneActionButtons
              tuneId={tuneId}
              media={media}
              onLyrics={shownAttributes?.hasLyrics ? readLyrics : null}
            />
          }
        />
        <div className={gutter}>
          {deletingName && (
            <p role="status" className="t-secondary text-secondary pb-6">
              {DELETING}
            </p>
          )}
          <ErrorLine error={screen.error} place="inline" />
        </div>
        {column ? (
          // The attributes grow into spare width beside the content, then the rest falls past them.
          <div className="max-w-tune-columns grid grid-cols-[minmax(0,var(--container-page))_clamp(var(--container-attributes),100%_-_var(--container-page)_-_var(--attributes-gap),var(--container-attributes-max))] gap-x-(--attributes-gap)">
            <div className="px-7 pt-4 pb-12">{sections}</div>
            {attributesPanel}
          </div>
        ) : (
          <div className="max-w-page mx-auto flex w-full flex-col gap-8 px-4 pb-12">
            {attributesPanel}
            <div>{sections}</div>
          </div>
        )}
      </article>
      {scans.overlays}
      <ListPickerSheet
        isOpen={picking && current && !deletingName}
        onOpenChange={setPicking}
        userTuneIds={screen.pickerTuneIds}
        title={ADD_TO_LIST_TITLE}
      />
      {/* A tune gone while it reads, here or on another device, leaves nothing to read. */}
      <LyricsReader
        tuneId={tuneId}
        title={title ?? ''}
        lyrics={screen.tune?.tune.lyrics ?? null}
        isOpen={reading && current && screen.tune !== undefined && !deletingName}
        onOpenChange={setReading}
      />
      <EditRecordingSheet view={media.editing} onClose={() => media.setEditing(null)} />
      <PasteLinkSheet
        tuneId={tuneId}
        isOpen={media.pasting && current}
        onOpenChange={media.setPasting}
      />
      <FindRecordingsSheet
        tuneId={tuneId}
        service={media.only ?? undefined}
        isOpen={media.finding && current}
        onOpenChange={media.setFinding}
      />
    </div>
  )
}

/**
 * Withdraws the Undo a just-created tune's toast offers once anything is added to the tune, so
 * Undo never deletes the musician's work. The page takes the tune's mark as it opens, so a
 * page left behind forgets it.
 */
function useUndoWithdrawn(tuneId: string, attached: boolean) {
  const toast = useToast()
  // A ref, so the double mount of development's strict mode keeps what the first took.
  const toastId = useRef<number | null>(null)
  useEffect(() => {
    const taken = takeFresh(tuneId)
    if (taken !== null) toastId.current = taken
  }, [tuneId])
  useEffect(() => {
    if (!attached || toastId.current === null) return
    toast.dropUndo(toastId.current)
    toastId.current = null
  }, [attached, toast])
}

function TuneSections({
  tuneId,
  screen,
  media,
  scans,
  recordAvailable,
  onRecord,
  onEditLyrics,
  onReadLyrics,
  lyricsOpen,
  onLyricsOpenChange,
  lists,
}: {
  tuneId: string
  screen: TuneScreenData
  media: ReturnType<typeof useTuneMedia>
  scans: TuneScansParts
  recordAvailable: boolean
  /** Opens the recorder, filing the recording under this tune. */
  onRecord: () => void
  /** Opens the tune form at its lyrics, where they are written and edited. */
  onEditLyrics: () => void
  onReadLyrics: () => void
  lyricsOpen: boolean
  onLyricsOpenChange: (open: boolean) => void
  /** The lists and the day added, which end the page where the attributes are a card. */
  lists: ReactNode
}) {
  const lyrics = screen.tune?.tune.lyrics
  const verses = useMemo(() => lyricLines(lyrics), [lyrics])
  const hasLyrics = screen.attributes?.hasLyrics ?? false
  const addItems = media.addItems.map((item) =>
    item.label === NEW_RECORDING && !recordAvailable
      ? { ...item, disabled: RECORD_UNAVAILABLE }
      : item,
  )
  // A free plan folds its recordings into one line; opening it lasts for this visit only.
  const folded = !recordingsPlayable(usePlanOrUnknown()) && media.recordingRows.length > 0
  const [unfolded, setUnfolded] = useState(false)
  const recordingRows = folded && !unfolded ? [] : media.recordingRows
  const addScan = scans.loaded && !scans.has && !scans.adding
  // A first scan has no section to show it until it lands, so the add line says it is coming.
  const addingFirstScan = !scans.has && scans.adding
  const scansError = <ErrorLine error={scans.error} place="inline" />
  return (
    <>
      <PageSection
        title={RECORDINGS_SECTION}
        add={
          // The start card is the one way to add while the section is empty.
          media.empty ? undefined : (
            <Menu
              label={ADD_RECORDING}
              trigger={<Button icon={Plus} label={ADD_RECORDING} iconOnly />}
              items={menuEntries(addItems)}
            />
          )
        }
      >
        {media.empty ? (
          <FirstRecordingCard
            recordAvailable={recordAvailable}
            find={media.find}
            onRecord={onRecord}
            onPaste={() => media.setPasting(true)}
          />
        ) : (
          <>
            {folded && (
              <RecordingsLine
                count={media.recordingRows.length}
                expanded={unfolded}
                onToggle={() => setUnfolded((open) => !open)}
              />
            )}
            {recordingRows.length + media.linkRows.length > 0 && (
              <MediaList label={RECORDINGS_SECTION}>
                {recordingRows.map((row) => (
                  <RecordingRow
                    key={row.view.recording.id}
                    row={row}
                    onRetry={(kind) => media.retry(row.view, kind)}
                    premiumFrom={folded ? 'recordings_line' : undefined}
                  />
                ))}
                {media.linkRows.map((row) => (
                  <LinkRow key={row.link.id} row={row} />
                ))}
              </MediaList>
            )}
          </>
        )}
        <ErrorLine error={media.error} place="inline" />
      </PageSection>

      {hasLyrics && (
        <PageSection
          title={LYRICS_SECTION}
          open={lyricsOpen}
          onOpenChange={onLyricsOpenChange}
          add={
            <span className="flex items-center gap-1">
              <Button label={EDIT} name={EDIT_LYRICS} onPress={onEditLyrics} />
              <Button icon={BookOpen} label={OPEN_LYRICS} iconOnly onPress={onReadLyrics} />
            </span>
          }
        >
          <Verses verses={verses} />
        </PageSection>
      )}

      {scans.has && (
        <PageSection title={SCANS_SECTION} add={scans.controls}>
          {scans.content}
          {scansError}
        </PageSection>
      )}

      <PageSection title={NOTES_SECTION}>
        <NotesField tuneId={tuneId} notes={screen.notes} />
      </PageSection>

      {(addScan || addingFirstScan || !hasLyrics) && (
        <div role="group" aria-label={ADD_TO_TUNE} className="-mx-2 flex flex-wrap gap-1 pt-6">
          {!hasLyrics && (
            <AddAction name={ADD_LYRICS} text={ADD_LYRICS_TEXT} onPress={onEditLyrics} />
          )}
          {addScan && <AddAction name={ADD_SCAN} text={ADD_SCAN_TEXT} onPress={scans.add} />}
          {/* Mounted empty with the line, so screen readers hear the text when it arrives. */}
          <p
            role="status"
            className={
              addingFirstScan
                ? 't-secondary text-secondary flex min-h-(--target) items-center px-2'
                : 'sr-only'
            }
          >
            {addingFirstScan ? ADDING_SCAN : ''}
          </p>
        </div>
      )}
      {/* A first add that failed leaves no Scans and images section to say so. */}
      {!scans.has && scansError}
      {lists}
    </>
  )
}

function AddAction({ name, text, onPress }: { name: string; text: string; onPress: () => void }) {
  return (
    <AriaButton
      aria-label={name}
      onPress={onPress}
      className={`t-secondary text-secondary flex min-h-(--target) items-center gap-1 rounded-(--radius-row) px-2 ${TINT_HOVER}`}
    >
      <Plus className="text-accent size-4" aria-hidden />
      {text}
    </AriaButton>
  )
}
