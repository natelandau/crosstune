import { IonButton } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pause, Play, Repeat, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react'
import { updateLoop } from '../../commands/loops'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import { liveTune } from '../../db/tunes'
import { clamp } from '../../math'
import { getMode } from '../../platform/mode'
import { useLatest } from '../../ui/useLatest'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { PAUSE, PLAY, REPEAT_LOOP } from '../player/transportCopy'
import { formatPreciseDuration } from '../recording/format'
import {
  PANEL_ICON_BUTTON,
  PANEL_TEXT_BUTTON,
  ZOOM_IN,
  ZOOM_OUT,
  ZOOM_STEP,
} from '../recording-screen/panel'
import { trimmedLengthMs, type ShownPeaks } from '../recording-screen/recordingRange'
import { SKIP_BACK, SKIP_FORWARD, SKIP_MS } from '../recording-screen/Transport'
import { Waveform } from '../recording-screen/Waveform'
import { useZoomGestures } from '../recording-screen/useZoomGestures'
import type { RecordingView } from '../recordings/useRecordings'
import { loopAt, loopName, resizeSpan, roomAround, rowSpan, spanFields } from './loopModel'
import { LoopsPanel, NEW_LOOP_REASON } from './LoopsPanel'
import { LoopSwitcher } from './LoopSwitcher'
import { ModeControls, ModeSelector } from './ModePanel'
import { OverviewStrip } from './OverviewStrip'
import { FIT, LANES_LABEL, LOCKED_LOOPS_NOTICE, LOOP_SELECTED } from './practiceCopy'
import { fitScale, MAX_PX_PER_S, minPxPerS, openingScale, zoomScale } from './practiceZoom'
import { PracticeWaveform, type LaneLoop, type WaveformScrub } from './PracticeWaveform'
import { useLoopCommands } from './useLoopCommands'
import { useLoopDrafts } from './useLoopDrafts'
import { useLoopPlayback } from './useLoopPlayback'
import { useLoops } from './useLoops'
import { usePracticeKeys } from './usePracticeKeys'
import { usePracticeMode } from './usePracticeMode'
import { usePracticeSettings } from './usePracticeSettings'

/** The waveform's ruler and the gap under it, which the bars' height leaves room for. */
const RULER_PX = 20

/**
 * The recording screen's working view: the overview, the waveform under a fixed playhead, the
 * Loops, Speed, and Pitch selector, the readout and transport with the loop switcher and zoom,
 * and the chosen mode's controls. It drives the engine the dock loaded, owns the zoom and the
 * keyboard, and holds speed and pitch ahead of the row while a change settles.
 */
export function Practice({
  view,
  shown,
  modal,
  blocked,
  escapeRef,
  onError,
}: {
  view: RecordingView
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  modal: RefObject<HTMLIonModalElement | null>
  /** Why the waveform, transport, and modes cannot be used yet, such as a take still recording. */
  blocked?: string
  /** Set to what Escape does here before the screen closes; true when it did something. */
  escapeRef?: RefObject<(() => boolean) | null>
  /** A refused write to show on the screen; null clears it. */
  onError: (message: string | null) => void
}) {
  const { recording, file } = view
  const db = useDb()
  const engine = usePlaybackEngine()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const trimStartMs = recording.trim_start_ms
  const loaded = state.lengthMs > 0
  // Offline, unavailable, or failed audio has nothing to play, so no loop can be placed by ear.
  const audioReady = loaded && !state.failed
  const lengthMs = loaded ? state.lengthMs : (trimmedLengthMs(recording, file) ?? 0)
  const positionMs = loaded ? state.positionMs : 0
  const enginePlayheadMs = trimStartMs + positionMs

  // Every command acts where the playhead shows, which a scrub or glide under way moves ahead
  // of the engine, and stops a glide first so it cannot carry the playhead off afterward.
  const scrub = useRef<WaveformScrub | null>(null)
  const [scrubbingMs, setScrubbingMs] = useState<number | null>(null)
  const shownMs = loaded ? (scrubbingMs ?? positionMs) : 0
  const playheadMs = trimStartMs + shownMs
  const settle = () => {
    scrub.current?.settleGlide()
  }
  /** The shown playhead on the trimmed timeline, which a playing engine can be ahead of. */
  const shownPositionMs = () => scrub.current?.shownMs() ?? engine.getState().positionMs
  const bounds = useMemo(
    () => ({ startMs: trimStartMs, endMs: trimStartMs + lengthMs }),
    [trimStartMs, lengthMs],
  )

  const [announcement, setAnnouncement] = useState('')
  const announceFrame = useRef(0)
  // Emptied first and filled a frame later, so a message the region already holds is read again.
  const announce = useCallback((message: string) => {
    setAnnouncement('')
    cancelAnimationFrame(announceFrame.current)
    announceFrame.current = requestAnimationFrame(() => setAnnouncement(message))
  }, [])
  useEffect(() => () => cancelAnimationFrame(announceFrame.current), [])

  const loopRows = useLoops(recording.id)
  const rows = useMemo(() => loopRows ?? [], [loopRows])
  const playback = useLoopPlayback(view, loopRows)
  const tuneId = view.tuneId
  const partStructure = useLiveQuery(
    async () => (tuneId ? (liveTune(await db.tunes.get(tuneId))?.part_structure ?? null) : null),
    [db, tuneId],
  )
  const commands = useLoopCommands({
    recordingId: recording.id,
    loops: rows,
    playback,
    playheadMs,
    bounds,
    announce,
    onError,
  })
  const selectedRow = commands.selected
  const nameOf = (row: LocalRecordingLoop) => loopName(row.label ?? null, row.start_ms, trimStartMs)

  const laneLoops = useMemo<LaneLoop[]>(
    () =>
      rows.map((loop) => ({
        id: loop.id,
        startMs: loop.start_ms,
        endMs: loop.end_ms,
        color: loop.color,
        name: loopName(loop.label ?? null, loop.start_ms, trimStartMs),
        label: loop.label ?? null,
      })),
    [rows, trimStartMs],
  )

  const { drafts, onDraft, onCommit } = useLoopDrafts({
    rows,
    playback,
    playheadMs,
    onError: commands.report,
  })

  const selected = selectedRow
    ? {
        id: selectedRow.id,
        name: nameOf(selectedRow),
        color: selectedRow.color,
        span: drafts[selectedRow.id]?.span ?? rowSpan(selectedRow),
      }
    : null

  /** `[` and `]`: one edge of the selected loop to the playhead, held to the room around it. */
  const setEdge = (edge: 'start' | 'end', atMs: number) => {
    if (!selectedRow) return
    const span = rowSpan(selectedRow)
    const others = commands.placed.filter((loop) => loop.id !== selectedRow.id)
    const next = resizeSpan(span, edge, atMs, roomAround(span, others, bounds))
    if (next.startMs === span.startMs && next.endMs === span.endMs) return
    updateLoop(db, selectedRow.id, spanFields(next)).catch(commands.report)
  }

  const content = useRef<HTMLDivElement>(null)
  const waveformSlider = () =>
    content.current?.querySelector<HTMLElement>(`[role="slider"][aria-label="${LANES_LABEL}"]`)
  /** Focus a closed name field left on nothing goes back to the loop's name tab. */
  const refocusTab = (id: string) =>
    requestAnimationFrame(() => {
      const focused = document.activeElement
      if (focused && focused !== document.body && focused !== modal.current) return
      content.current
        ?.querySelector<HTMLElement>(`button[data-name-tab="${CSS.escape(id)}"]`)
        ?.focus()
    })
  const removeSelected = () => {
    commands.remove()
    // Delete goes disabled with the loop, which would drop focus onto the page.
    waveformSlider()?.focus()
  }

  // The field's own blur after it closes would save again, so a rename ends here exactly once.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renaming = useRef<string | null>(null)
  const startRename = (id: string) => {
    renaming.current = id
    setRenamingId(id)
  }
  const endRename = () => {
    const id = renaming.current
    renaming.current = null
    setRenamingId(null)
    if (id) refocusTab(id)
  }
  const commitRename = (id: string, label: string) => {
    if (renaming.current !== id) return
    endRename()
    const row = rows.find((loop) => loop.id === id)
    if (!row || (row.label ?? '') === label) return
    updateLoop(db, id, { label }).catch(commands.report)
  }

  const onTap = (sourceMs: number) => {
    const hit = loopAt(sourceMs, commands.placed)
    if (!hit) {
      if (playback.selectedId) playback.select(null)
      return
    }
    if (hit.id === playback.selectedId) return
    playback.select(hit.id)
    const row = rows.find((loop) => loop.id === hit.id)
    if (row) announce(LOOP_SELECTED(nameOf(row)))
  }

  // The zoom is a scale only: the playhead is always the view's center.
  const slot = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = slot.current
    if (!element) return
    // An observer reports the size it starts with, so this also takes the first measurement.
    const observer = new ResizeObserver(() =>
      setSize((prev) =>
        prev.width === element.clientWidth && prev.height === element.clientHeight
          ? prev
          : { width: element.clientWidth, height: element.clientHeight },
      ),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const widthPx = size.width
  const frame = { widthPx, lengthMs }
  const minScale = minPxPerS(widthPx, lengthMs)
  const [scale, setScale] = useState<number | null>(null)
  if (scale === null && widthPx > 0 && lengthMs > 0 && loopRows !== undefined) {
    setScale(openingScale(selectedRow ? rowSpan(selectedRow) : null, playheadMs, widthPx))
  }
  // Held to the frame as it stands, so turning the phone keeps the scale wherever it still fits.
  const pxPerS = scale === null ? null : clamp(scale, minScale, MAX_PX_PER_S)
  const frameRef = useLatest(frame)
  const zoom = (factor: number) =>
    setScale((current) =>
      current === null ? current : zoomScale(current, factor, frameRef.current),
    )
  const fit = () => {
    settle()
    if (!selected) {
      setScale(minScale)
      return
    }
    const { span } = selected
    const atMs = trimStartMs + shownPositionMs()
    setScale(Math.max(minScale, fitScale(span, atMs, widthPx)))
    // The playhead is the view's center, so a loop it sits outside of is brought to it.
    if (atMs < span.startMs || atMs >= span.endMs) engine.seek(span.startMs - trimStartMs)
  }

  const pinches = useRef(0)
  const pinch = useZoomGestures(slot, (action) => zoom(action.factor), {
    onFirstPointer: () => {},
    onPinchStart: () => {
      pinches.current += 1
    },
  })

  const { speed, pitch, changeSpeed, changePitch } = usePracticeSettings({ recording, onError })

  const [mode, setMode] = usePracticeMode()
  const togglePlay = () => (engine.getState().playing ? engine.pause() : engine.play())

  const nameById = (id: string) => {
    const row = rows.find((loop) => loop.id === id)
    return row ? nameOf(row) : ''
  }
  usePracticeKeys(modal, escapeRef, {
    blocked,
    canEdit: audioReady,
    trimStartMs,
    settle,
    shownPositionMs,
    selectedId: selectedRow?.id ?? null,
    isRenaming: () => renaming.current !== null,
    togglePlay,
    setEdge,
    // New loop's reason is never on screen, so a refused N says why aloud.
    create: (atMs) => {
      const reason = NEW_LOOP_REASON(commands.create(atMs), nameById)
      if (reason) announce(reason)
    },
    removeSelected,
    startRename,
    endRename,
    deselect: () => playback.select(null),
    zoom,
  })

  const playing = state.playing
  const repeatName = selected && !playing ? selected.name : null
  const half = pxPerS ? (widthPx / 2 / pxPerS) * 1000 : 0
  const off = blocked ? 'pointer-events-none opacity-50' : ''

  return (
    <div ref={content} className="flex min-h-0 flex-1 flex-col gap-3">
      <div inert={!!blocked} className={off}>
        {pxPerS ? (
          <OverviewStrip
            shown={shown}
            lengthMs={lengthMs}
            trimStartMs={trimStartMs}
            visible={{ startMs: shownMs - half, endMs: shownMs + half }}
            loops={laneLoops}
            playheadMs={playheadMs}
            selectedId={playback.selectedId}
            onSeek={(ms) => {
              settle()
              engine.seek(ms)
            }}
          />
        ) : (
          <div data-overview data-timeline-bar>
            <TimelineBar heightClass="h-5" />
          </div>
        )}
      </div>
      <div
        ref={slot}
        inert={!!blocked}
        className={`practice-waveform-slot relative shrink-0 ${off}`}
        style={
          {
            '--practice-detail-height': `${Math.max(0, size.height - RULER_PX)}px`,
          } as CSSProperties
        }
        {...pinch}
      >
        {pxPerS ? (
          <div className="absolute inset-0">
            <PracticeWaveform
              shown={shown}
              loops={laneLoops}
              selected={selected}
              pxPerS={pxPerS}
              widthPx={widthPx}
              bounds={bounds}
              playheadMs={enginePlayheadMs}
              renamingId={renamingId}
              onTap={onTap}
              onRenameStart={startRename}
              onRenameCommit={commitRename}
              onRenameCancel={endRename}
              onDraft={onDraft}
              onCommit={onCommit}
              pinches={pinches}
              scrubRef={scrub}
              onScrubbing={setScrubbingMs}
            />
          </div>
        ) : (
          // Until the take's length is known there is no scale, only a plain bar.
          <div
            data-practice-waveform
            data-timeline-bar
            className="absolute inset-0 flex flex-col justify-center"
          >
            <TimelineBar heightClass="practice-detail" />
          </div>
        )}
      </div>
      {/* The waveform's height never follows what is below it, so this region scrolls instead. */}
      <div data-practice-below className="flex min-h-16 flex-1 flex-col gap-3 overflow-y-auto">
        <div inert={!!blocked} className={`mx-auto w-full max-w-(--measure) ${off}`}>
          <ModeSelector mode={mode} onMode={setMode} speedPercent={speed} pitchCents={pitch} />
        </div>
        {/* The play controls always sit at the row's middle. Equal side columns keep them there
            from a tablet up; a phone gives them a line of their own under the clock and zoom. */}
        <div
          data-practice-transport
          className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[1fr_auto_1fr] sm:items-start"
        >
          <p
            data-practice-clock
            className="type-timer col-start-1 row-start-1 m-0 flex min-h-11 items-center tabular-nums max-sm:text-[2rem] sm:min-h-16"
          >
            {blocked ?? formatPreciseDuration(shownMs)}
          </p>
          <div className="col-span-2 row-start-2 flex flex-col items-center justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <div className="flex items-center gap-2">
              <IonButton
                fill="clear"
                aria-label={SKIP_BACK}
                disabled={!loaded || !!blocked}
                onClick={() => {
                  settle()
                  engine.seek(shownPositionMs() - SKIP_MS)
                }}
              >
                <RotateCcw aria-hidden="true" className="size-6" />
              </IonButton>
              <IonButton
                shape="round"
                className="size-16"
                aria-label={playing ? PAUSE : repeatName ? REPEAT_LOOP(repeatName) : PLAY}
                disabled={!loaded || !!blocked}
                onClick={togglePlay}
              >
                {playing ? (
                  <Pause aria-hidden="true" fill="currentColor" className="size-7" />
                ) : repeatName ? (
                  <Repeat aria-hidden="true" className="size-7" />
                ) : (
                  <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-7" />
                )}
              </IonButton>
              <IonButton
                fill="clear"
                aria-label={SKIP_FORWARD}
                disabled={!loaded || !!blocked}
                onClick={() => {
                  settle()
                  engine.seek(shownPositionMs() + SKIP_MS)
                }}
              >
                <RotateCw aria-hidden="true" className="size-6" />
              </IonButton>
            </div>
            <LoopSwitcher
              loops={rows}
              playback={playback}
              playheadMs={playheadMs}
              trimStartMs={trimStartMs}
              disabled={!loaded || !!blocked}
              onCommand={settle}
              // The playhead is the view's center, so the loop's start comes to it.
              onReveal={(span) => engine.seek(span.startMs - trimStartMs)}
              announce={announce}
            />
          </div>
          <div className="col-start-2 row-start-1 flex min-h-11 items-center gap-1 justify-self-end sm:col-start-3 sm:min-h-16">
            <button
              type="button"
              aria-label={ZOOM_OUT}
              className={PANEL_ICON_BUTTON}
              disabled={!pxPerS || !!blocked || pxPerS <= minScale}
              onClick={() => zoom(1 / ZOOM_STEP)}
            >
              <ZoomOut aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              className={PANEL_TEXT_BUTTON}
              disabled={!pxPerS || !!blocked}
              onClick={fit}
            >
              {FIT}
            </button>
            <button
              type="button"
              aria-label={ZOOM_IN}
              className={PANEL_ICON_BUTTON}
              disabled={!pxPerS || !!blocked || pxPerS >= MAX_PX_PER_S}
              onClick={() => zoom(ZOOM_STEP)}
            >
              <ZoomIn aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
        <div inert={!!blocked} className={`mx-auto w-full max-w-(--measure) ${off}`}>
          <ModeControls
            mode={mode}
            speedPercent={speed}
            pitchCents={pitch}
            onSpeed={changeSpeed}
            onPitch={changePitch}
            pitchUnavailable={state.pitchUnavailable}
            loops={
              <LoopsPanel
                recordingId={recording.id}
                loops={rows}
                playback={playback}
                playheadMs={playheadMs}
                bounds={bounds}
                renamingId={renamingId}
                partStructure={partStructure ?? null}
                canCreate={audioReady}
                onCommand={() => {
                  settle()
                  return trimStartMs + shownPositionMs()
                }}
                onCreated={() => {}}
                onError={onError}
                announce={announce}
                // The panel writes the chosen name; the field closes without saving its own text.
                onSuggestion={endRename}
                onRemoved={() => waveformSlider()?.focus()}
              />
            }
          />
        </div>
        {/* iOS suspends a page whose screen locks, and with it the timer that wraps a repeating loop. */}
        {selected && getMode() === 'ios' ? (
          <p className="type-footnote m-0 text-center text-(--ion-color-medium)">
            {LOCKED_LOOPS_NOTICE}
          </p>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only" data-practice-announcer>
        {announcement}
      </p>
    </div>
  )
}

/** The take as one plain bar, for a stretch with no length to scale yet. */
function TimelineBar({ heightClass }: { heightClass: string }) {
  return (
    <Waveform
      peaks={null}
      lengthMs={0}
      positionMs={0}
      heightClass={heightClass}
      decorative
      onSeek={() => {}}
    />
  )
}
