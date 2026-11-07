import { Ellipsis } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Dialog, Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import { useLocation, useNavigate } from 'react-router'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { useLeaveTo, useLeaveWhenMissing } from '../../layout/backHistory'
import { destination } from '../../layout/destinations'
import { usePaneHeight } from '../../layout/pane'
import { BackLink, PaneBar } from '../../layout/PaneBar'
import { tuneHomePath } from '../../layout/tuneHome'
import { useFrame } from '../../platform/frame'
import { useWakeLock } from '../../platform/wakeLock'
import { attributesLayout } from '../../ui/attributes/attributesLayout'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { Menu } from '../../ui/Menu'
import { segmentedTrack } from '../../ui/segmentedTrack'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { isOverlayOpen, useOverlayClaim, useOverlayOpen } from '../../ui/overlayClaim'
import { menuEntries } from '../../ui/sharedActions'
import { useElementSize } from '../../ui/useElementSize'
import { useLatest } from '../../ui/useLatest'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { springEasing } from '../../theme/motion'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { RecordingPageLayout, Source } from '../../usage/events'
import { isMonoFromRow, isolateFromRow } from '../player/isolate/isolateSetting'
import { usePremiumSheet } from '../plan/PremiumSheetProvider'
import {
  practiceDisabledReason,
  splitDisabledReason,
  trimDisabledReason,
} from '../practice/practiceAvailability'
import { usePracticeHolds } from '../practice/practiceHolds'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useShowsRecordingPage } from '../player/pagePlayback'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { useRecordingEngine } from '../practice/useRecordingEngine'
import { PracticeView, type SavedFocus } from '../practice/PracticeView'
import { SplitPanel } from '../practice/SplitPanel'
import { TrimPanel } from '../practice/TrimPanel'
import { inPractice, type PracticeKeyScope } from '../practice/usePracticeKeys'
import { usePracticeLog } from '../practice/usePracticeLog'
import { useTrimHold } from '../practice/useTrimHold'
import { SUBSCRIBE_TO_PLAY } from '../recordings/recordingCopy'
import { useRecordingActionsWith } from '../recordings/useRecordingActionsWith'
import type { RecordingView } from '../recordings/useRecordings'
import { useUploadLimits } from '../recordings/useUploadLimits'
import { useUserTune } from '../tune/useUserTune'
import { PlayBar } from './PlayBar'
import { DETAILS, PRACTICE } from './recordingPageCopy'
import { RecordingAttributes } from './recordingEditors'
import { entryOf, reportedEntry } from './recordingPageState'
import { useRecordingPageView, type RecordingPageView } from './useRecordingPageView'

const RECORDINGS = destination('recordings')

// Practice's dark scheme, and the spring a snapped loop handle settles with.
const PRACTICE_STYLE = { colorScheme: 'dark', '--spring': springEasing() } as CSSProperties

// Practice remounts only with its recording, so there is no earlier view's focus to carry.
const NO_SAVED_FOCUS: SavedFocus = { peek: () => null, keep: () => {} }

/**
 * One recording as a page, in the detail of the tab it opened from. At compact widths, and
 * wherever its column is too narrow for practice beside the attributes, it shows Details and
 * Practice as tabs; wider, practice fills the page beside the attributes column. The page
 * belongs to its recording, never to the player: opening it leaves playback alone, and Play
 * loads it. Playback its Play loads is the page's own, with no dock, and stops when the page
 * goes; while it shows the loaded recording, its controls are the only player. Back returns
 * to `parent`, named `parentLabel`, which the page also leaves for once its recording is gone.
 */
export function RecordingPage({
  recordingId,
  parent,
  parentLabel,
}: {
  recordingId: string
  parent: string
  parentLabel: string
}) {
  const location = useLocation()
  const [opening] = useState(() => entryOf(location.state))
  const source: Source = opening.source ?? (parent === RECORDINGS.root ? 'recordings_list' : 'tune')
  useShowsRecordingPage(recordingId)
  const state = useRecordingPageView(recordingId)
  const { view, shows } = state
  const recordingsPlay = useRecordingsPlayable()

  // The page's own width, not the device's, picks the layout.
  const root = useRef<HTMLDivElement>(null)
  const width = useElementSize(root).width
  // Nothing shows until the width is known, so practice never mounts in a layout it then leaves.
  const measured = width > 0
  const wide = attributesLayout(width) === 'column'
  // Practice's keys reach the whole page, its tabs and header included, but its attribute rows.
  const attributes = useRef<HTMLElement>(null)
  const [keyScope] = useState<PracticeKeyScope>(() => ({ root, outside: [attributes] }))
  // Every page opens on Practice. Nothing carries the tab from one page to the next.
  const [tab, chooseTab] = useState<RecordingPageTab>('practice')
  const shownTab = recordingsPlay ? tab : 'details'
  const editing = shows !== 'main'
  const practiceShown = !editing && (wide || shownTab === 'practice')
  const practiceShownRef = useLatest(practiceShown)
  // Practice renders into one node that each layout's slot holds, so a tab switch or the fold
  // moves it rather than remounting it, and its zoom and selected loop hold.
  const [practiceHost] = useState(() => {
    const host = document.createElement('div')
    host.className = 'contents'
    return host
  })

  const navigate = useNavigate()
  const pathRef = useLatest(location.pathname + location.search)
  useOpenedReport({
    recordingId,
    source,
    layout: wide ? 'wide' : shownTab,
    ready: measured && view !== null && opening.reported !== true,
    // The entry keeps who opened it and from where, so Back and reload onto it neither report
    // it again nor reopen the tab this open asked for.
    onReported: () =>
      void navigate(pathRef.current, { replace: true, state: reportedEntry(opening) }),
  })
  useLeaveWhenMissing(state.missing, parent)

  // An opener that asks for Practice, such as the dock's Expand, hands the page the keyboard,
  // so practice's keys work at once; focus left on the opener would sit outside the page.
  const takesFocus = useRef(opening.tab === 'practice')
  useEffect(() => {
    if (!takesFocus.current || !measured || view === null) return
    takesFocus.current = false
    root.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  }, [measured, view])

  const holds = usePracticeHolds()
  // Practice of a recording the player has not loaded hears nothing, so what plays meanwhile
  // stays the dock's own play.
  const inPlayer = isPlaying(usePlayer(), { kind: 'recording', id: recordingId })
  usePracticeLog(practiceShown && inPlayer ? recordingId : null, holds)
  // One engine for Details, practice, and the editors, so a scrub or loop in one holds in the next.
  const recordingEngine = useRecordingEngine(view)
  // A recording practiced with the device propped up with the hands on the violin, must not dim.
  useWakeLock(practiceShown || editing)

  const leaveTo = useLeaveTo()
  const openTune = (tuneId: string) => {
    if (parent.split('/').at(-1) === tuneId) leaveTo(parent)
    else void navigate(tuneHomePath(tuneId))
  }
  const confirm = useConfirm()
  const uploadLimits = useUploadLimits()
  const userTune = useUserTune(view?.tuneId ?? null)
  const actions = useRecordingActionsWith({
    confirm,
    pin: userTune
      ? { userTuneId: userTune.id, recordingId: userTune.play_recording_id ?? null }
      : undefined,
    // A control with nothing to act on is absent, so a free plan's menu has no Trim.
    onTrim: recordingsPlay ? () => state.openEditor('trim') : undefined,
    trimBlocked: view
      ? trimDisabledReason(view.recording, view.file, uploadLimits, state.audio, recordingsPlay)
      : undefined,
    onSplit: recordingsPlay ? () => state.openEditor('split') : undefined,
    splitBlocked: view
      ? splitDisabledReason(view.recording, view.file, uploadLimits, state.audio, recordingsPlay)
      : undefined,
    onOpenTune: (opened) => {
      if (opened.tuneId) openTune(opened.tuneId)
    },
  })

  // Leaving trim or split puts focus back on More, once whatever it stacked, such as Save's
  // question, has let go of it.
  const moreRef = useRef<HTMLButtonElement>(null)
  const returning = useRef(false)
  const overlayOpen = useOverlayOpen()
  useEffect(() => {
    if (editing) returning.current = true
    else if (returning.current && !overlayOpen) {
      returning.current = false
      moreRef.current?.focus()
    }
  }, [editing, overlayOpen])

  const paneHeight = usePaneHeight()
  // Practice keeps one height whatever it shows, so the page fills the pane rather than
  // scrolling in it while practice or an editor shows.
  const fills = (practiceShown || editing) && paneHeight > 0
  const error = actions.error ?? state.error
  // Why practice and the play bar cannot play the recording yet, a plan that plays none first.
  const blocked = view
    ? practiceDisabledReason(view.recording, view.file, state.audio, recordingsPlay)
    : undefined

  return (
    <div
      ref={root}
      className={fills ? 'flex flex-col' : undefined}
      style={fills ? { height: `calc(${paneHeight}px - var(--float-clearance))` } : undefined}
    >
      {!measured ? null : editing && view ? (
        <Editor state={state} view={view} engine={recordingEngine.engine} />
      ) : (
        <>
          <PageHeader
            title={state.title}
            subtitle={state.subtitle}
            parent={parent}
            parentLabel={parentLabel}
            more={
              <Menu
                label={MORE_ACTIONS}
                trigger={
                  <Button
                    ref={moreRef}
                    icon={Ellipsis}
                    label={MORE_ACTIONS}
                    iconOnly
                    isDisabled={!view}
                  />
                }
                items={view ? menuEntries(actions.pageMenuFor(view)) : []}
              />
            }
          />
          {view &&
            (wide ? (
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(var(--container-attributes),100%_-_var(--container-page)_-_var(--attributes-gap),var(--container-attributes-max))] gap-x-(--attributes-gap)">
                <PracticeSlot host={practiceHost} />
                <RecordingAttributes
                  ref={attributes}
                  view={view}
                  location={state.location}
                  layout="column"
                />
              </div>
            ) : (
              <Tabs
                selectedKey={shownTab}
                onSelectionChange={(key) => chooseTab(key === 'practice' ? 'practice' : 'details')}
                disabledKeys={recordingsPlay ? [] : ['practice']}
                className={fills ? 'flex min-h-0 flex-1 flex-col' : undefined}
              >
                <TabList aria-label={state.title} className={`${segmentedTrack('page')} mx-4 mb-3`}>
                  <PageTab id="practice">{PRACTICE}</PageTab>
                  <PageTab id="details">{DETAILS}</PageTab>
                </TabList>
                <TabPanel id="details" className="flex flex-col gap-6 px-4 pb-12">
                  <ErrorLine error={error} place="inline" />
                  <PlayBar
                    engine={recordingEngine.engine}
                    title={state.title}
                    lengthMs={state.rowLengthMs}
                    blocked={blocked}
                    playable={recordingsPlay}
                    recordingId={recordingId}
                  />
                  <RecordingAttributes view={view} location={state.location} layout="card" />
                </TabPanel>
                <TabPanel id="practice" className="flex min-h-0 flex-1 flex-col">
                  <PracticeSlot host={practiceHost} />
                </TabPanel>
              </Tabs>
            ))}
        </>
      )}
      {measured &&
        !editing &&
        view &&
        createPortal(
          <PracticeArea
            state={state}
            view={view}
            error={error}
            engine={recordingEngine}
            blocked={blocked}
            recordingsPlay={recordingsPlay}
            keyScope={keyScope}
            shownRef={practiceShownRef}
          />,
          practiceHost,
        )}
    </div>
  )
}

/** Where practice shows in the layout the page has now, holding `host`. */
function PracticeSlot({ host }: { host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    slot.current?.append(host)
    return () => host.remove()
  }, [host])
  return <div ref={slot} className="contents" />
}

type RecordingPageTab = 'details' | 'practice'

function PageTab({ id, children }: { id: RecordingPageTab; children: ReactNode }) {
  return (
    <Tab
      id={id}
      className="t-body text-secondary data-[selected]:bg-page data-[selected]:text-primary flex min-h-(--target-control) flex-1 cursor-default items-center justify-center rounded-(--radius-capsule) px-3 outline-none data-[disabled]:opacity-50 data-[focus-visible]:outline-2 data-[focus-visible]:outline-(--accent)"
    >
      {children}
    </Tab>
  )
}

/** Back, the recording's title over when it was recorded and how long it plays, and More. */
function PageHeader({
  title,
  subtitle,
  parent,
  parentLabel,
  more,
}: {
  title: string
  subtitle: string
  parent: string
  parentLabel: string
  more: ReactNode
}) {
  // Off the phone More sits on the title's row, as it does on a tune's page.
  const moreOnTitle = useFrame() !== 'phone'
  return (
    <>
      <PaneBar
        leading={<BackLink to={parent} label={parentLabel} />}
        trailing={!moreOnTitle && more}
      />
      <header className="flex items-center gap-2 px-4 pt-2 pb-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 tabIndex={-1} data-pane-focus className="t-page-title truncate">
            {title}
          </h1>
          <p data-recording-subtitle className="t-secondary text-secondary">
            {subtitle}
          </p>
        </div>
        {moreOnTitle && more}
      </header>
    </>
  )
}

/** Practice on its own background: the overview, waveform, transport, and modes. */
function PracticeArea({
  state,
  view,
  error,
  engine,
  blocked,
  recordingsPlay,
  keyScope,
  shownRef,
}: {
  state: RecordingPageView
  view: RecordingView
  error: string | null
  engine: ReturnType<typeof useRecordingEngine>
  keyScope: PracticeKeyScope
  /** Whether practice shows now; hidden behind Details it hears no keys. */
  shownRef: RefObject<boolean>
  /** Why practice cannot play the recording yet. */
  blocked: string | undefined
  /** Whether the plan plays recordings. */
  recordingsPlay: boolean
}) {
  const premium = usePremiumSheet()
  // Escape steps out of what practice holds, such as a rename or the selected loop.
  const escapeRef = useRef<(() => boolean) | null>(null)
  const isTop = () => shownRef.current && !isOverlayOpen()
  useStepOutOfPractice(escapeRef, keyScope, isTop)
  return (
    <div
      data-practice
      className="bg-practice-background text-on-practice flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4"
      style={PRACTICE_STYLE}
    >
      <ErrorLine error={error} place="stack" />
      {state.trimNotice && (
        <p role="status" className="t-secondary m-0 text-center">
          {state.trimNotice}
        </p>
      )}
      {!recordingsPlay && (
        <Button
          label={SUBSCRIBE_TO_PLAY}
          onPress={() => premium.open('recordings', 'recording_page')}
        />
      )}
      <PracticeView
        view={view}
        engine={engine.engine}
        loaded={engine.loaded}
        shown={state.peaks}
        blocked={blocked}
        escapeRef={escapeRef}
        savedFocus={NO_SAVED_FOCUS}
        isTop={isTop}
        keyScope={keyScope}
        onError={state.setError}
      />
    </div>
  )
}

/** Hands Escape to practice while it is on top, and lets it go on when practice has nothing to
 * step out of. */
function useStepOutOfPractice(
  escapeRef: RefObject<(() => boolean) | null>,
  scope: PracticeKeyScope,
  isTop: () => boolean,
) {
  useEscapeCapture(() => escapeRef.current?.() ?? false, {
    when: (event) => !event.defaultPrevented && isTop() && inPractice(event.target, scope),
  })
}

/**
 * The trim or split view in place of the page, claiming back and Escape as an overlay does. It
 * drives the page's own engine, so editing a recording the player has not loaded never touches
 * what plays.
 */
function Editor({
  state,
  view,
  engine,
}: {
  state: RecordingPageView
  view: RecordingView
  engine: PlaybackEngine
}) {
  return (
    <PlaybackEngineContext.Provider value={engine}>
      <EditorPanel state={state} view={view} />
    </PlaybackEngineContext.Provider>
  )
}

function EditorPanel({ state, view }: { state: RecordingPageView; view: RecordingView }) {
  // A device back steps out as Escape does, through whichever editor is showing.
  const stepOutRef = useRef<(() => void) | null>(null)
  const isTop = useOverlayClaim({ coversShell: true, close: () => stepOutRef.current?.() })
  const { recording } = view
  useTrimHold(recording.id, true, {
    speed: recording.speed_percent,
    pitch: recording.pitch_cents,
    isolate: isolateFromRow(recording),
    isMono: isMonoFromRow(recording),
  })
  const Panel = state.shows === 'trim' ? TrimPanel : SplitPanel
  // A dialog, so the editor takes its name from its header's title as it did over practice.
  return (
    <Dialog
      data-practice
      className="bg-practice-background text-on-practice flex min-h-0 flex-1 flex-col pb-4 outline-none"
      style={PRACTICE_STYLE}
    >
      <Panel
        view={view}
        shown={state.peaks}
        isTop={isTop}
        stepOutRef={stepOutRef}
        onDone={state.leaveEditor}
        onTrimmedElsewhere={state.trimmedElsewhere}
      />
    </Dialog>
  )
}

/** Sends `recording_page_opened` once per open, once the layout the page shows is known. */
function useOpenedReport({
  recordingId,
  source,
  layout,
  ready,
  onReported,
}: {
  recordingId: string
  source: Source
  layout: RecordingPageLayout
  ready: boolean
  onReported: () => void
}) {
  const analytics = useAnalytics()
  const sent = useRef(false)
  const onReportedRef = useLatest(onReported)
  useEffect(() => {
    if (sent.current || !ready) return
    sent.current = true
    analytics.send('recording_page_opened', { recording_id: recordingId, layout, source })
    onReportedRef.current()
  }, [analytics, recordingId, layout, source, ready, onReportedRef])
}
