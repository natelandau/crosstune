import { Ellipsis, Pencil, Plus } from 'lucide-react'
import {
  addTransitionType,
  startTransition,
  use,
  useEffect,
  useMemo,
  useState,
  ViewTransition,
} from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { Link, useLocation } from 'react-router'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { lyricOpening } from '../lyrics/lyricLines'
import { NEW_RECORDING } from '../recording/recordCopy'
import type { RecordingView } from '../recordings/useRecordings'
import { ADD_RECORDING } from './tuneMediaCopy'
import {
  ADD_LYRICS,
  ADD_NOTES,
  ADD_TO_LIST_TITLE,
  EDIT_LYRICS,
  EDIT_NOTES,
  EDIT_TUNE,
  learnedLine,
  LISTS_SECTION,
  LYRICS_SECTION,
  NOTES_SECTION,
  OPEN_LYRICS,
  RECORDINGS_SECTION,
} from './tuneScreenCopy'
import { useTuneMedia } from './useTuneMedia'
import { useTuneScreen, type TuneScreenData } from './useTuneScreen'
import { DELETING } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { useLeaveTo } from '../../app/backTrail'
import { FindRecordingsSheet } from '../links/FindRecordingsSheet'
import { PasteLinkSheet } from '../links/PasteLinkSheet'
import { LyricsReader } from '../lyrics/LyricsReader'
import { useFrame } from '../../platform/frame'
import { EditRecordingSheet } from '../recordings/EditRecordingSheet'
import { ListPickerSheet } from '../selection/ListPickerSheet'
import { useDetailPage } from '../../app/Columns'
import { BackLink, PaneBar } from '../../app/PaneBar'
import { RECORD_UNAVAILABLE, useRecordLauncher } from '../../app/recordLauncher'
import { Button } from '../../ui/Button'
import { CAPSULE_HIT } from '../../ui/Capsule'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { Menu } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { useTuneFormLauncher } from './formLauncher'
import { LinkRow, MediaList, RecordingRow } from './MediaRow'
import { PageSection } from './PageSection'
import { TuneHeader } from './TuneHeader'
import { isQuietPick } from './tunePick'
import { TuneScans } from './TuneScans'
import { readTuneTitle, rememberTuneTitle } from './tuneTitle'

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
    () => () =>
      quiet
        ? setShown(tuneId)
        : startTransition(() => {
            addTransitionType(SWAP)
            setShown(tuneId)
          }),
    [quiet, tuneId],
  )
  // One keyed list, so the page held on screen keeps its state while the next one reads.
  const documents = waiting ? [shown, tuneId] : [tuneId]
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
      <div>
        {documents.map((id) =>
          id === tuneId ? (
            <TuneDocument
              key={id}
              tuneId={id}
              parent={parent}
              parentLabel={parentLabel}
              knownTitle={knownTitle}
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
  current,
  knownTitle,
  hidden = false,
  onRead,
}: {
  tuneId: string
  parent: string
  parentLabel: string
  /** True for the page of the tune the address names; false for one held while it reads. */
  current: boolean
  /** The title read before the page showed, for its heading until the facts read. */
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
  const { ready, missing, facts, deletingName } = screen
  const [picking, setPicking] = useState(false)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    if (ready || missing) onRead()
  }, [ready, missing, onRead])

  const readTitle = facts?.title
  useEffect(() => {
    if (readTitle !== undefined) rememberTuneTitle(db, tuneId, readTitle)
  }, [db, tuneId, readTitle])

  // A held page whose tune went away stays until the next page replaces it.
  useEffect(() => {
    if (current && missing) leaveTo(parent)
  }, [current, missing, leaveTo, parent])

  const shownFacts = ready && !deletingName ? facts : null
  const title = shownFacts?.title ?? deletingName ?? knownTitle ?? undefined
  const more = menuEntries(screen.menuFor(() => setPicking(true)))

  return (
    <div hidden={hidden} inert={hidden}>
      <PaneBar
        title={title}
        leading={<BackLink to={parent} label={parentLabel} />}
        trailing={
          shownFacts && (
            <>
              <Button label={EDIT_TUNE} onPress={() => form.open({ tuneId })} />
              <Menu
                label={MORE_ACTIONS}
                trigger={<Button icon={Ellipsis} label={MORE_ACTIONS} iconOnly />}
                items={more}
              />
            </>
          )
        }
      />
      <article className="max-w-page mx-auto w-full px-4 pt-2 pb-12">
        <TuneHeader
          tuneId={tuneId}
          facts={shownFacts}
          title={title}
          badges={screen.badges}
          active={!hidden}
        />
        {deletingName && (
          <p role="status" className="t-secondary text-ink-2 -mt-4 pb-6">
            {DELETING}
          </p>
        )}
        <ErrorLine error={screen.error} place="title" />
        {shownFacts && (
          <TuneSections
            tuneId={tuneId}
            screen={screen}
            media={media}
            recordAvailable={record.available}
            onEdit={() => form.open({ tuneId })}
            onAddToList={() => setPicking(true)}
            onReadLyrics={() => setReading(true)}
          />
        )}
      </article>
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

function TuneSections({
  tuneId,
  screen,
  media,
  recordAvailable,
  onEdit,
  onAddToList,
  onReadLyrics,
}: {
  tuneId: string
  screen: TuneScreenData
  media: ReturnType<typeof useTuneMedia>
  recordAvailable: boolean
  /** Opens the tune form, where lyrics and notes are written. */
  onEdit: () => void
  onAddToList: () => void
  onReadLyrics: () => void
}) {
  const lyrics = screen.tune?.tune.lyrics
  const opening = useMemo(() => lyricOpening(lyrics, 1)[0], [lyrics])
  const addItems = media.addItems.map((item) =>
    item.label === NEW_RECORDING && !recordAvailable
      ? { ...item, disabled: RECORD_UNAVAILABLE }
      : item,
  )
  const learned = learnedLine(screen.learnedFrom, screen.learnedOn)
  return (
    <>
      <PageSection
        title={RECORDINGS_SECTION}
        add={
          <Menu
            label={ADD_RECORDING}
            trigger={<Button icon={Plus} label={ADD_RECORDING} iconOnly />}
            items={menuEntries(addItems)}
          />
        }
      >
        {(!media.empty || media.error) && (
          <>
            {!media.empty && (
              <MediaList label={RECORDINGS_SECTION}>
                {media.recordingRows.map((row) => (
                  <RecordingRow
                    key={row.view.recording.id}
                    row={row}
                    onRetry={(kind) => media.retry(row.view, kind)}
                  />
                ))}
                {media.linkRows.map((row) => (
                  <LinkRow key={row.link.id} row={row} />
                ))}
              </MediaList>
            )}
            <ErrorLine error={media.error} place="inline" />
          </>
        )}
      </PageSection>

      <TuneScans tuneId={tuneId} />

      <PageSection
        title={LYRICS_SECTION}
        addLabel={screen.facts?.hasLyrics ? EDIT_LYRICS : ADD_LYRICS}
        addIcon={screen.facts?.hasLyrics ? Pencil : Plus}
        onAdd={onEdit}
      >
        {screen.facts?.hasLyrics && (
          <AriaButton
            onPress={onReadLyrics}
            className="-mx-3 flex min-h-(--target) w-[calc(100%+1.5rem)] cursor-default flex-col items-start rounded-(--radius-row) px-3 py-1.5 text-start data-[pressed]:opacity-60"
          >
            <span className="t-body">{OPEN_LYRICS}</span>
            {opening && <span className="t-secondary text-ink-2 truncate">{opening}</span>}
          </AriaButton>
        )}
      </PageSection>

      <PageSection title={LISTS_SECTION} addLabel={ADD_TO_LIST} onAdd={onAddToList}>
        {screen.inLists.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {screen.inLists.map((list) => (
              <li key={list.id}>
                <Link
                  to={`/lists/${list.id}`}
                  className={`t-secondary bg-fill text-ink inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${CAPSULE_HIT}`}
                >
                  {list.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection
        title={NOTES_SECTION}
        addLabel={screen.notes ? EDIT_NOTES : ADD_NOTES}
        addIcon={screen.notes ? Pencil : Plus}
        onAdd={onEdit}
      >
        {(screen.notes || screen.learned) && (
          <>
            {screen.learned && (
              <p className="t-secondary text-ink-2">
                {learned.words}
                {learned.date && <span className="t-num">{learned.date}</span>}
              </p>
            )}
            {screen.notes && (
              <p className="t-body pt-1 whitespace-pre-wrap select-text">{screen.notes}</p>
            )}
          </>
        )}
      </PageSection>
    </>
  )
}
