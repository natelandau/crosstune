import { IonButton, IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/react'
import { ArrowLeftToLine, ArrowRightToLine, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { CANCEL, useConfirm } from '../../ui/Confirm'
import { InlineError } from '../../ui/InlineError'
import { isControl, isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import { PAUSE } from '../player/Dock'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { TICK_MS } from '../player/playbackEngine'
import { formatDuration, formatPreciseDuration } from '../recording/format'
import { PANEL_ICON_BUTTON, PANEL_TEXT_BUTTON } from './panel'
import type { ShownPeaks } from './recordingRange'
import {
  detailWindow,
  initialTrim,
  isChanged,
  trimPatch,
  trimReducer,
  type TrimHandle,
} from './trimModel'
import { END_HANDLE, START_HANDLE, TrimStrip } from './TrimStrip'
import { useZoomGestures } from './useZoomGestures'

export const TRIM = 'Trim'
export const SAVE_TRIM = 'Save'
export const SET_START = 'Set start'
export const SET_END = 'Set end'
export const PLAY_SELECTION = 'Play selection'
export const PREVIEW_END = 'Preview end'
export const GO_TO_START = 'Go to start'
export const GO_TO_END = 'Go to end'
export const ZOOM_IN = 'Zoom in'
export const ZOOM_OUT = 'Zoom out'
export const LENGTH_LABEL = 'Length'
export const OVERVIEW_LABEL = 'Whole recording'
export const DETAIL_LABEL = 'Zoomed in'
export const TRIM_NOT_SAVED = 'The trim could not be saved.'
export const TRIM_CONFIRM_MESSAGE = "This can't be undone."
export const TRIM_CONFIRM_ACTION = 'Trim'

/** `Trim to 3:12?`, the length the recording keeps. */
export function TRIM_CONFIRM_TITLE(lengthMs: number): string {
  return `Trim to ${formatDuration(lengthMs)}?`
}

const PREVIEW_MS = 3000
const ZOOM_STEP = 2
/**
 * How far short of the end handle playback may stop. The engine reports its position once a
 * tick, so stopping within half a tick of the handle lands nearer it than waiting a whole one.
 */
const STOP_EARLY_MS = TICK_MS / 2

/**
 * Where the musician cuts a recording down to the tune: an overview of the whole current
 * recording, a zoomed detail around the handle last touched, and a transport for hearing the
 * cut. It plays at 100% speed and no pitch shift (the recording screen sees to that) so what
 * is heard is exactly what is cut.
 */
export function TrimView({
  recording,
  file,
  shown,
  modal,
  onDone,
  onTrimmedElsewhere,
}: {
  recording: LocalRecording
  file: RecordingFile | undefined
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  modal: RefObject<HTMLIonModalElement | null>
  onDone: () => void
  /** The row's trim changed while the view was open, so the handles no longer line up. */
  onTrimmedElsewhere: () => void
}) {
  const db = useDb()
  const engine = usePlaybackEngine()
  const confirm = useConfirm()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const [trim, dispatch] = useReducer(trimReducer, undefined, () => initialTrim(recording, file))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The detail holds still while one of its own handles is dragged, so the bars do not slide
  // out from under the pointer.
  const [heldWindow, setHeldWindow] = useState<[number, number] | null>(null)
  const low = trim.bounds[0]
  const loaded = state.lengthMs > 0
  const playheadMs = low + (loaded ? state.positionMs : 0)
  const detail = heldWindow ?? detailWindow(trim)
  const changed = isChanged(trim, recording)

  // Every handle, seek, and the write itself count from the trim the view opened on. A trim
  // landing from elsewhere moves what the engine plays, so the view gives way rather than cut
  // the recording somewhere the musician did not choose.
  const [opened] = useState(() => ({
    start: recording.trim_start_ms,
    end: recording.trim_end_ms,
  }))
  const trimmedElsewhere =
    recording.trim_start_ms !== opened.start || recording.trim_end_ms !== opened.end
  const writing = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const stale = useRef(trimmedElsewhere)
  useLayoutEffect(() => {
    stale.current = trimmedElsewhere
  })
  useEffect(() => {
    if (trimmedElsewhere && !writing.current) onTrimmedElsewhere()
  }, [trimmedElsewhere, onTrimmedElsewhere])

  const cancel = useRef<HTMLIonButtonElement>(null)
  // The control that opened this view is gone with the view it sat in, so focus starts on
  // the way back out rather than falling to the page.
  useEffect(() => {
    const element = cancel.current
    if (!element) return
    let live = true
    let frame = 0
    void Promise.resolve(element.componentOnReady?.()).then(() => {
      // One frame on, once the view that held the opener has left the page.
      frame = requestAnimationFrame(() => {
        if (live) element.shadowRoot?.querySelector('button')?.focus()
      })
    })
    return () => {
      live = false
      cancelAnimationFrame(frame)
    }
  }, [])

  // Play selection and Preview end run up to the end handle and stop on it. The check reads
  // the handle as it stands, so moving it while playing moves where playback stops.
  const stopAtEnd = useRef(false)
  const latest = useRef(trim)
  useLayoutEffect(() => {
    latest.current = trim
  })
  useEffect(() => {
    // The engine rewinds to the range start when it reaches the range end, even paused, so
    // a stop there parks a millisecond short of it.
    const park = (endMs: number) => Math.min(endMs, Math.max(0, engine.getState().lengthMs - 1))
    let wasPlaying = engine.getState().playing
    let awaitingRewind = false
    const unsubscribe = engine.subscribe((next) => {
      const endMs = latest.current.end - low
      if (awaitingRewind) {
        awaitingRewind = false
        if (!next.playing && next.positionMs === 0) engine.seek(park(endMs))
      } else if (stopAtEnd.current) {
        if (next.playing && next.positionMs >= endMs - STOP_EARLY_MS) {
          stopAtEnd.current = false
          engine.pause()
          engine.seek(park(endMs))
        } else if (wasPlaying && !next.playing) {
          stopAtEnd.current = false
          // A pause with the end handle on the range end is the engine running off it, and
          // its rewind comes next; any other pause leaves the next play an ordinary one.
          // The engine's rewind follows its pause inside the same tick, so a wait that
          // outlasts the tick was an ordinary pause.
          awaitingRewind = endMs >= next.lengthMs - STOP_EARLY_MS
          if (awaitingRewind) queueMicrotask(() => (awaitingRewind = false))
        }
      }
      wasPlaying = engine.getState().playing
    })
    return () => {
      stopAtEnd.current = false
      unsubscribe()
    }
  }, [engine, low])

  const goTo = (ms: number) =>
    engine.seek(Math.min(ms - low, Math.max(0, engine.getState().lengthMs - 1)))
  const playFrom = (ms: number) => {
    engine.seek(ms - low)
    stopAtEnd.current = true
    engine.play()
  }
  const setAtPlayhead = (handle: TrimHandle) =>
    dispatch({ type: 'setAtPlayhead', handle, ms: low + engine.getState().positionMs })

  const playSelection = () => playFrom(latest.current.start)
  const keys = useRef({ setAtPlayhead, playSelection })
  useLayoutEffect(() => {
    keys.current = { setAtPlayhead, playSelection }
  })
  // Space is Play selection, so it stops on the end handle like the button. The arrows belong
  // to a focused handle, which nudges it; with none focused they do nothing here.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '[' && event.key !== ']' && event.key !== ' ') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isTextEntry(event.target) || !isTopOverlay(modal.current)) return
      if (event.key === ' ' && isControl(event.target)) return
      if (engine.getState().lengthMs === 0) return
      event.preventDefault()
      if (event.key === ' ') {
        if (engine.getState().playing) engine.pause()
        else keys.current.playSelection()
      } else {
        keys.current.setAtPlayhead(event.key === '[' ? 'start' : 'end')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, modal])

  const detailBox = useRef<HTMLDivElement>(null)
  const beforePinch = useRef({ positionMs: 0, start: trim.start, end: trim.end })
  const pinch = useZoomGestures(detailBox, dispatch, {
    onFirstPointer: () => {
      beforePinch.current = {
        positionMs: engine.getState().positionMs,
        start: latest.current.start,
        end: latest.current.end,
      }
    },
    onPinchStart: () => {
      const { positionMs, start, end } = beforePinch.current
      engine.seek(positionMs)
      dispatch({ type: 'restore', start, end })
      setHeldWindow(null)
    },
  })

  const save = async () => {
    const answer = await confirm({
      title: TRIM_CONFIRM_TITLE(trim.end - trim.start),
      message: TRIM_CONFIRM_MESSAGE,
      action: TRIM_CONFIRM_ACTION,
    })
    // The view can have given way while the question was up.
    if (!answer || !live.current || stale.current) return
    writing.current = true
    setSaving(true)
    setError(null)
    try {
      await updateRecording(db, recording.id, trimPatch(trim, recording))
      onDone()
    } catch (caught) {
      writing.current = false
      setSaving(false)
      // A row that is gone takes the whole screen with it, so there is nothing to report.
      if (caught instanceof Error && caught.message === RECORDING_NOT_FOUND) return
      setError(TRIM_NOT_SAVED)
    }
  }

  const canZoomIn = trimReducer(trim, { type: 'zoom', factor: ZOOM_STEP }).zoom > trim.zoom
  const canZoomOut = trim.zoom > 1

  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton ref={cancel} onClick={onDone}>
              {CANCEL}
            </IonButton>
          </IonButtons>
          <IonTitle>{TRIM}</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={!changed || saving} onClick={() => void save()}>
              {SAVE_TRIM}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="mx-auto flex w-full max-w-(--measure) flex-col gap-5 px-4 py-4">
          {error ? <InlineError className="text-center">{error}</InlineError> : null}
          <TrimStrip
            range={trim.bounds}
            trim={trim}
            dispatch={dispatch}
            shown={shown}
            playheadMs={playheadMs}
            loaded={loaded}
            label={OVERVIEW_LABEL}
            compact
            announced
            onSeek={(ms) => engine.seek(ms - low)}
          />
          <div ref={detailBox} data-trim-detail {...pinch}>
            <TrimStrip
              range={detail}
              trim={trim}
              dispatch={dispatch}
              shown={shown}
              playheadMs={playheadMs}
              loaded={loaded}
              label={DETAIL_LABEL}
              onSeek={(ms) => engine.seek(ms - low)}
              onDragChange={(dragging) => setHeldWindow(dragging ? detail : null)}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={ZOOM_OUT}
              className={PANEL_ICON_BUTTON}
              disabled={!canZoomOut}
              onClick={() => dispatch({ type: 'zoom', factor: 1 / ZOOM_STEP })}
            >
              <ZoomOut aria-hidden="true" className="size-5" />
            </button>
            <dl className="type-footnote grid flex-1 grid-cols-3 text-center tabular-nums">
              <div>
                <dt className="text-(--ion-color-medium)">{START_HANDLE}</dt>
                <dd>{formatPreciseDuration(trim.start - low)}</dd>
              </div>
              <div>
                <dt className="text-(--ion-color-medium)">{LENGTH_LABEL}</dt>
                <dd>{formatPreciseDuration(trim.end - trim.start)}</dd>
              </div>
              <div>
                <dt className="text-(--ion-color-medium)">{END_HANDLE}</dt>
                <dd>{formatPreciseDuration(trim.end - low)}</dd>
              </div>
            </dl>
            <button
              type="button"
              aria-label={ZOOM_IN}
              className={PANEL_ICON_BUTTON}
              disabled={!canZoomIn}
              onClick={() => dispatch({ type: 'zoom', factor: ZOOM_STEP })}
            >
              <ZoomIn aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <IonButton disabled={!loaded} onClick={() => setAtPlayhead('start')}>
              {SET_START}
            </IonButton>
            <IonButton disabled={!loaded} onClick={() => setAtPlayhead('end')}>
              {SET_END}
            </IonButton>
          </div>
          <div className="flex items-center justify-center gap-6">
            <IonButton
              fill="clear"
              aria-label={GO_TO_START}
              disabled={!loaded}
              onClick={() => goTo(trim.start)}
            >
              <ArrowLeftToLine aria-hidden="true" className="size-7" />
            </IonButton>
            <IonButton
              shape="round"
              className="size-16"
              aria-label={state.playing ? PAUSE : PLAY_SELECTION}
              disabled={!loaded}
              onClick={() => (state.playing ? engine.pause() : playFrom(trim.start))}
            >
              {state.playing ? (
                <Pause aria-hidden="true" fill="currentColor" className="size-7" />
              ) : (
                <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-7" />
              )}
            </IonButton>
            <IonButton
              fill="clear"
              aria-label={GO_TO_END}
              disabled={!loaded}
              onClick={() => goTo(trim.end)}
            >
              <ArrowRightToLine aria-hidden="true" className="size-7" />
            </IonButton>
          </div>
          <button
            type="button"
            className={`${PANEL_TEXT_BUTTON} self-center`}
            disabled={!loaded}
            onClick={() => playFrom(Math.max(trim.start, trim.end - PREVIEW_MS))}
          >
            {PREVIEW_END}
          </button>
        </div>
      </IonContent>
    </>
  )
}
