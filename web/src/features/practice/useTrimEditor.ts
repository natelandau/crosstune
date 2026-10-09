import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
} from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { isControl, isTextEntry } from '../../ui/keyTarget'
import { useLatest } from '../../ui/useLatest'
import { TICK_MS, type PlaybackEngine } from '../player/playbackEngine'
import type { RecordingView } from '../recordings/useRecordings'
import { ZOOM_STEP } from './panel'
import {
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_MESSAGE,
  TRIM_CONFIRM_TITLE,
  TRIM_NOT_SAVED,
} from './trimViewCopy'
import {
  detailWindow,
  initialTrim,
  isChanged,
  trimPatch,
  trimReducer,
  type TrimAction,
  type TrimHandle,
  type TrimState,
} from './trimModel'
import { useZoomGestures } from './useZoomGestures'

const PREVIEW_MS = 3000
/**
 * How far short of the end handle playback may stop. The engine reports its position once a
 * tick, so stopping within half a tick of the handle lands nearer it than waiting a whole one.
 */
const STOP_EARLY_MS = TICK_MS / 2

export interface TrimEditorOptions {
  view: Pick<RecordingView, 'recording' | 'file'>
  engine: PlaybackEngine
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  /** The trim is saved, or the editor has nothing left to do. */
  onDone: () => void
  /** The row's trim changed while the editor was open, so the handles no longer line up. */
  onTrimmedElsewhere: () => void
  /** True while nothing is stacked over the editor, so its keys are its own. */
  isTop: () => boolean
}

export interface TrimEditor {
  trim: TrimState
  dispatch: Dispatch<TrimAction>
  /** The start of the row's current trim, which the engine's timeline counts from. */
  low: number
  /** True once the engine knows the audio's length. */
  loaded: boolean
  playing: boolean
  /** The engine's position on the source timeline. */
  playheadMs: number
  /** The stretch of the source the detail waveform shows. */
  detail: [number, number]
  /** True once either handle has left the row's current trim. */
  changed: boolean
  /** Moves the playhead onto a handle. */
  goTo: (edge: TrimHandle) => void
  /** Seeks to `ms` on the source timeline. */
  seek: (ms: number) => void
  /** Plays from `ms` on the source timeline and stops on the end handle. */
  playFrom: (ms: number) => void
  setAtPlayhead: (edge: TrimHandle) => void
  playSelection: () => void
  /** Pauses while playing, otherwise plays the selection. */
  togglePlay: () => void
  /** Plays the last few seconds of the selection. */
  previewEnd: () => void
  zoom: (direction: 'in' | 'out') => void
  canZoomIn: boolean
  canZoomOut: boolean
  /** Asks first, then writes the trim. */
  save: () => Promise<void>
  saving: boolean
  error: string | null
  /** The detail waveform's box, which pinches and ctrl-scrolls zoom. */
  detailBox: RefObject<HTMLDivElement | null>
  /** The pinch handlers for `detailBox`. */
  pinch: ReturnType<typeof useZoomGestures>
  /** Holds the detail still while one of its own handles is dragged. */
  holdDetail: (dragging: boolean) => void
}

/**
 * Trim's logic: the handles, a transport that stops on the end
 * handle, the `[`, `]`, and Space keys, pinch zoom, and the confirmed write. The caller holds
 * the engine at 100% speed and no pitch shift, so what is heard is exactly what is cut.
 */
export function useTrimEditor({
  view,
  engine,
  confirm,
  onDone,
  onTrimmedElsewhere,
  isTop,
}: TrimEditorOptions): TrimEditor {
  const { recording, file } = view
  const db = useDb()
  const analytics = useAnalytics()
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

  // Every handle, seek, and the write itself count from the trim the editor opened on. A trim
  // landing from elsewhere moves what the engine plays, so the editor gives way rather than
  // cut the recording somewhere the musician did not choose.
  const [opened] = useState(() => ({
    start: recording.trim_start_ms,
    end: recording.trim_end_ms,
  }))
  const trimmedElsewhere =
    recording.trim_start_ms !== opened.start || recording.trim_end_ms !== opened.end
  const writing = useRef(false)
  const live = useRef(true)
  // Withdraws an open Save question once there is nothing for it to act on.
  const question = useRef<AbortController | null>(null)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      question.current?.abort()
    }
  }, [])
  const staleRef = useLatest(trimmedElsewhere)
  const onTrimmedElsewhereRef = useLatest(onTrimmedElsewhere)
  useEffect(() => {
    if (!trimmedElsewhere || writing.current) return
    question.current?.abort()
    onTrimmedElsewhereRef.current()
  }, [trimmedElsewhere, onTrimmedElsewhereRef])

  // Play selection and Preview end run up to the end handle and stop on it. The check reads
  // the handle as it stands, so moving it while playing moves where playback stops.
  const stopAtEnd = useRef(false)
  const latestRef = useLatest(trim)
  useEffect(() => {
    // The engine rewinds to the range start when it reaches the range end, even paused, so
    // a stop there parks a millisecond short of it.
    const park = (endMs: number) => Math.min(endMs, Math.max(0, engine.getState().lengthMs - 1))
    let wasPlaying = engine.getState().playing
    let awaitingRewind = false
    const unsubscribe = engine.subscribe((next) => {
      const endMs = latestRef.current.end - low
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
  }, [engine, low, latestRef])

  const seek = (ms: number) => engine.seek(ms - low)
  const goTo = (edge: TrimHandle) =>
    engine.seek(Math.min(trim[edge] - low, Math.max(0, engine.getState().lengthMs - 1)))
  const playFrom = (ms: number) => {
    engine.seek(ms - low)
    stopAtEnd.current = true
    engine.play()
  }
  const setAtPlayhead = (edge: TrimHandle) =>
    dispatch({ type: 'setAtPlayhead', handle: edge, ms: low + engine.getState().positionMs })
  const playSelection = () => playFrom(latestRef.current.start)
  const togglePlay = () => (engine.getState().playing ? engine.pause() : playSelection())
  const previewEnd = () => playFrom(Math.max(trim.start, trim.end - PREVIEW_MS))

  const isTopRef = useLatest(isTop)
  const keysRef = useLatest({ setAtPlayhead, togglePlay })
  // Space is Play selection, so it stops on the end handle like the button. The arrows belong
  // to a focused handle, which nudges it; with none focused they do nothing here. A layout
  // effect, so the keys work from the commit that shows the handles rather than after a
  // passive effect that a busy page can run later.
  useLayoutEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '[' && event.key !== ']' && event.key !== ' ') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isTextEntry(event.target) || !isTopRef.current()) return
      if (event.key === ' ' && isControl(event.target)) return
      if (engine.getState().lengthMs === 0) return
      event.preventDefault()
      if (event.key === ' ') {
        keysRef.current.togglePlay()
      } else {
        keysRef.current.setAtPlayhead(event.key === '[' ? 'start' : 'end')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, isTopRef, keysRef])

  const detailBox = useRef<HTMLDivElement>(null)
  const beforePinch = useRef({ positionMs: 0, start: trim.start, end: trim.end })
  const pinch = useZoomGestures(
    detailBox,
    (zoom) => dispatch({ type: 'zoom', factor: zoom.factor }),
    {
      onFirstPointer: () => {
        beforePinch.current = {
          positionMs: engine.getState().positionMs,
          start: latestRef.current.start,
          end: latestRef.current.end,
        }
      },
      onPinchStart: () => {
        const { positionMs, start, end } = beforePinch.current
        engine.seek(positionMs)
        dispatch({ type: 'restore', start, end })
        setHeldWindow(null)
      },
    },
  )

  const save = async () => {
    const controller = new AbortController()
    question.current = controller
    const answer = await confirm({
      title: TRIM_CONFIRM_TITLE(trim.end - trim.start),
      message: TRIM_CONFIRM_MESSAGE,
      action: TRIM_CONFIRM_ACTION,
      signal: controller.signal,
    })
    if (question.current === controller) question.current = null
    // The editor can have given way while the question was up.
    if (!answer || !live.current || staleRef.current) return
    writing.current = true
    setSaving(true)
    setError(null)
    try {
      await updateRecording(db, recording.id, trimPatch(trim, recording))
      analytics.send('recording_trimmed', { recording_id: recording.id })
      onDone()
    } catch (caught) {
      writing.current = false
      setSaving(false)
      // A row that is gone takes practice with it, so there is nothing to report.
      if (caught instanceof Error && caught.message === RECORDING_NOT_FOUND) return
      setError(TRIM_NOT_SAVED)
    }
  }

  return {
    trim,
    dispatch,
    low,
    loaded,
    playing: state.playing,
    playheadMs,
    detail,
    changed,
    goTo,
    seek,
    playFrom,
    setAtPlayhead,
    playSelection,
    togglePlay,
    previewEnd,
    zoom: (direction) =>
      dispatch({ type: 'zoom', factor: direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP }),
    canZoomIn: trimReducer(trim, { type: 'zoom', factor: ZOOM_STEP }).zoom > trim.zoom,
    canZoomOut: trim.zoom > 1,
    save,
    saving,
    error,
    detailBox,
    pinch,
    holdDetail: (dragging) => setHeldWindow(dragging ? detail : null),
  }
}

/** What `TrimStrips` reads from the editor, kept apart so no object holding a ref is a prop. */
export function stripProps(editor: TrimEditor) {
  return {
    trim: editor.trim,
    dispatch: editor.dispatch,
    playheadMs: editor.playheadMs,
    loaded: editor.loaded,
    detail: editor.detail,
    seek: editor.seek,
    detailBox: editor.detailBox,
    pinch: editor.pinch,
    holdDetail: editor.holdDetail,
  }
}
