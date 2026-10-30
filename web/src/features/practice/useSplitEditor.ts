import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { splitRecording } from '../../commands/split'
import { useDb } from '../../db/DbProvider'
import { clamp } from '../../math'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { isControl, isTextEntry } from '../../ui/keyTarget'
import { SOMETHING_WENT_WRONG } from '../../ui/useAction'
import { useElementSize } from '../../ui/useElementSize'
import { useLatest } from '../../ui/useLatest'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import type { PlaybackEngine } from '../player/playbackEngine'
import { useEngineState } from '../player/PlaybackEngineProvider'
import {
  usePlayhead,
  usePlayheadClock,
  type FrameSource,
  type Moving,
} from '../player/playheadClock'
import type { RecordingView } from '../recordings/useRecordings'
import { NUDGE_LARGE_MS, NUDGE_MS, ZOOM_STEP } from './panel'
import { MAX_PX_PER_S, minPxPerS, OPENING_SPAN_MS, zoomScale } from './practiceZoom'
import { SPLIT_CONFIRM_ACTION, SPLIT_CONFIRM_MESSAGE, SPLIT_CONFIRM_TITLE } from './splitCopy'
import {
  canAddCut,
  canSave,
  initialSplit,
  pieces,
  splitReducer,
  type SplitAction,
  type SplitState,
} from './splitModel'
import { useEditorSave } from './useEditorSave'
import { useZoomGestures } from './useZoomGestures'

export interface SplitEditorOptions {
  view: Pick<RecordingView, 'recording' | 'file'>
  engine: PlaybackEngine
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  /** The split is saved. */
  onDone: () => void
  /** The row's trim changed while the editor was open, so the cuts no longer line up. */
  onTrimmedElsewhere: () => void
  /** True while nothing is stacked over the editor, so its keys are its own. */
  isTop: () => boolean
  /** What the playhead's frames run on, for a test to step them. */
  frames?: FrameSource
}

export interface SplitEditor {
  split: SplitState
  loaded: boolean
  playing: boolean
  /**
   * The line on the source timeline: the play position while playing, else where it was left.
   * It moves every frame outside React while playing.
   */
  line: Moving<number>
  /** The line to the nearest 0.1 s, which renders only as often as that changes. */
  shownLineMs: number
  /** True when the main button would add a cut at the line now. */
  canAdd: boolean
  /** True when the main button removes the selected cut rather than adding one. */
  removes: boolean
  /** Adds a cut at the line, or removes the selected one. */
  pressMain: () => void
  /** Moves the line to `ms` on the source timeline, letting go of a selected cut. */
  seekTo: (ms: number) => void
  skip: (deltaMs: number) => void
  togglePlay: () => void
  /** Selects cut `index`, or lets it go when it is already selected. */
  toggleCut: (index: number) => void
  /** The piece Play plays alone, from its start to its end. */
  selectedPiece: number | null
  /** Selects piece `index`, or lets it go when it is already selected. */
  togglePiece: (index: number) => void
  /** A cut's handle: moves cut `index` to `ms` on the source timeline, leaving the line. */
  moveCut: (index: number, ms: number) => void
  /** Moves the line alone by `deltaMs`, as a handle dragged to the strip's edge pans it. */
  panBy: (deltaMs: number) => void
  /** Counts pinches, so a press that gave way to one neither taps nor drags a handle. */
  pinches: RefObject<number>
  previous: () => void
  next: () => void
  /** A drag of the zoomed strip: it holds playback, then moves the line by `deltaMs` from where
   * the drag began, and the line comes to rest where it lets go. */
  scrubStart: () => void
  scrub: (deltaMs: number) => void
  scrubEnd: () => void
  /** A trackpad's sideways scroll, which moves the line by `deltaMs`. */
  scrubBy: (deltaMs: number) => void
  nudge: (deltaMs: number) => void
  /** The zoomed strip's box, which sets the scale and takes pinches and ctrl-scrolls. */
  stripBox: RefObject<HTMLDivElement | null>
  pinch: ReturnType<typeof useZoomGestures>
  /** Null until the strip has a width. */
  pxPerS: number | null
  /** Half the stretch the zoomed strip shows, which is centered on the line. */
  halfSpanMs: number
  zoom: (direction: 'in' | 'out') => void
  canZoomIn: boolean
  canZoomOut: boolean
  /** Asks first, then writes the split. */
  save: () => Promise<void>
  saving: boolean
  error: string | null
}

/**
 * Split's logic: the cuts and the line, a transport whose play position is the line, the
 * arrow, `s`, and Space keys, zoom, and the confirmed write. While paused the engine is held at
 * the line, so Play starts there. The caller holds the engine at 100% speed and no pitch shift,
 * so what is heard is exactly where the cut falls.
 */
export function useSplitEditor({
  view,
  engine,
  confirm,
  onDone,
  onTrimmedElsewhere,
  isTop,
  frames,
}: SplitEditorOptions): SplitEditor {
  const { recording, file } = view
  const db = useDb()
  const analytics = useAnalytics()
  const playing = useEngineState(engine, (s) => s.playing)
  const loaded = useEngineState(engine, (s) => s.lengthMs > 0)
  const clock = usePlayheadClock(engine, { frames })
  const [split, setSplit] = useState(() => initialSplit(recording, file))
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null)
  /**
   * Where playback last started or landed, on the source timeline. It stops at the first cut
   * after that, read from the current cuts so a moved cut moves the stop with it.
   */
  const playFrom = useRef<number | null>(null)
  // The state as of the last action, so actions in one handler build on each other.
  const current = useRef(split)
  const low = split.lowMs
  const spanMs = split.highMs - split.lowMs

  // The engine says it has paused only once the media element does, so actions applied in the
  // meantime treat playback as paused already. Handlers read the ref; rendering reads the state.
  const pausing = useRef(false)
  const [holding, setHolding] = useState(false)
  const setPausing = useCallback((value: boolean) => {
    pausing.current = value
    setHolding(value)
  }, [])
  const moving = playing && !holding

  /** Seeks the engine to `ms` on the source timeline, kept inside the loaded audio. */
  const seekEngine = useCallback(
    (ms: number, lengthMs: number) => engine.seek(clamp(ms - low, 0, Math.max(0, lengthMs - 1))),
    [engine, low],
  )
  const apply = useCallback(
    (action: SplitAction) => {
      const next = splitReducer(current.current, action)
      if (next === current.current) return
      current.current = next
      setSplit(next)
      const state = engine.getState()
      if ((!state.playing || pausing.current) && state.lengthMs > 0) {
        seekEngine(next.lineMs, state.lengthMs)
      }
    },
    [engine, seekEngine],
  )
  const restore = (state: SplitState) => {
    current.current = state
    setSplit(state)
    apply({ type: 'moveLine', ms: state.lineMs })
  }

  const playMs = useCallback(() => low + clamp(clock.get(), 0, spanMs), [clock, low, spanMs])
  const lineMs = split.lineMs
  const line = useMemo<Moving<number>>(
    () => ({ get: () => (moving ? playMs() : lineMs), subscribe: clock.subscribe }),
    [clock, moving, playMs, lineMs],
  )
  const shownLineMs = usePlayhead(line, (ms) => Math.round(ms / 100)) * 100

  // The line opens where practice left the playhead, and a pause leaves it where playback got to.
  useEffect(() => {
    if (!loaded) return
    const state = engine.getState()
    if (!state.playing) apply({ type: 'seek', ms: low + state.positionMs })
  }, [engine, loaded, low, apply])
  useEffect(() => {
    let wasPlaying = engine.getState().playing
    return engine.subscribe((next) => {
      const paused = wasPlaying && !next.playing
      wasPlaying = next.playing
      if (!paused) return
      playFrom.current = null
      if (pausing.current) {
        // The line already left the playhead when the pause was asked for.
        setPausing(false)
        seekEngine(current.current.lineMs, next.lengthMs)
        return
      }
      apply({ type: 'seek', ms: low + next.positionMs })
      apply({ type: 'rest' })
    })
  }, [engine, low, apply, setPausing, seekEngine])

  // Playback stops on the cut that ends its piece, with the line exactly on it, so the next Play
  // goes on into the following piece.
  useEffect(
    () =>
      clock.subscribe(() => {
        const from = playFrom.current
        if (from === null || !engine.getState().playing || pausing.current) return
        const state = current.current
        const endMs = state.cuts.find((cut) => cut > from) ?? state.highMs
        if (playMs() < endMs) return
        apply({ type: 'seek', ms: endMs })
        setPausing(true)
        engine.pause()
        apply({ type: 'rest' })
      }),
    [clock, engine, playMs, apply, setPausing],
  )

  const isPlaying = () => engine.getState().playing && !pausing.current
  /** Pauses for an edit, which then starts from where playback was. */
  const hold = () => {
    if (!isPlaying()) return
    apply({ type: 'seek', ms: playMs() })
    setPausing(true)
    engine.pause()
  }
  const seekLine = (ms: number) => {
    if (isPlaying()) {
      playFrom.current = clamp(ms, current.current.lowMs, current.current.highMs)
      seekEngine(ms, engine.getState().lengthMs)
      return
    }
    apply({ type: 'seek', ms })
    apply({ type: 'rest' })
  }
  const seekTo = (ms: number) => {
    setSelectedPiece(null)
    seekLine(ms)
  }
  const skip = (deltaMs: number) =>
    seekLine((isPlaying() ? playMs() : current.current.lineMs) + deltaMs)
  const togglePlay = () => {
    if (isPlaying()) {
      engine.pause()
      return
    }
    const state = current.current
    const piece = selectedPiece === null ? undefined : pieces(state)[selectedPiece]
    const startMs = piece ? piece.startMs : state.lineMs
    playFrom.current = startMs
    apply({ type: 'seek', ms: startMs })
    engine.play()
  }
  const togglePiece = (index: number) => {
    setSelectedPiece((was) => (was === index ? null : index))
  }
  const moveCut = (index: number, ms: number) => apply({ type: 'moveCut', index, ms })
  const panBy = (deltaMs: number) => {
    hold()
    apply({ type: 'seek', ms: current.current.lineMs + deltaMs })
  }
  const addCut = () => {
    setSelectedPiece(null)
    // A cut made while playing lands where playback is, which plays on.
    if (isPlaying()) apply({ type: 'seek', ms: playMs() })
    apply({ type: 'addCut' })
  }
  const nudge = (deltaMs: number) => {
    hold()
    apply({ type: 'nudge', ms: deltaMs })
    apply({ type: 'rest' })
  }
  const removes = split.selected !== null
  const canAdd = canAddCut(moving ? { ...split, lineMs: shownLineMs } : split)
  const pressMain = () => {
    if (!removes) {
      addCut()
      return
    }
    setSelectedPiece(null)
    apply({ type: 'removeCut' })
  }
  const toggleCut = (index: number) => {
    hold()
    if (current.current.selected === index) apply({ type: 'seek', ms: current.current.lineMs })
    else apply({ type: 'select', index })
  }

  const scrubFrom = useRef(0)
  const scrubStart = () => {
    hold()
    scrubFrom.current = current.current.lineMs
  }
  const scrub = (deltaMs: number) => apply({ type: 'moveLine', ms: scrubFrom.current + deltaMs })
  const scrubEnd = () => apply({ type: 'rest' })
  const scrubBy = (deltaMs: number) => {
    hold()
    apply({ type: 'moveLine', ms: current.current.lineMs + deltaMs })
    apply({ type: 'rest' })
  }

  const stripBox = useRef<HTMLDivElement>(null)
  const { width: widthPx } = useElementSize(stripBox)
  const zoomFrame = { widthPx, lengthMs: spanMs }
  const [chosenPxPerS, setChosenPxPerS] = useState<number | null>(null)
  const pxPerS =
    widthPx > 0
      ? (chosenPxPerS ?? zoomScale(widthPx / (OPENING_SPAN_MS / 1000), 1, zoomFrame))
      : null
  const zoomBy = (factor: number) => {
    if (pxPerS !== null) setChosenPxPerS(zoomScale(pxPerS, factor, zoomFrame))
  }
  const halfSpanMs = pxPerS ? (widthPx / 2 / pxPerS) * 1000 : 0

  // A pinch starts with one finger, which has already begun a drag by the time the second lands.
  const beforePinch = useRef(split)
  const pinches = useRef(0)
  const pinch = useZoomGestures(stripBox, (action) => zoomBy(action.factor), {
    onFirstPointer: () => {
      beforePinch.current = current.current
    },
    onPinchStart: () => {
      pinches.current += 1
      restore(beforePinch.current)
    },
  })

  const isTopRef = useLatest(isTop)
  const keysRef = useLatest({ nudge, addCut, togglePlay })
  // A layout effect, so the keys work from the commit that shows the panel rather than after a
  // passive effect that a busy page can run later.
  useLayoutEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // A focused cut handle has taken the arrows for itself.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTextEntry(event.target) || !isTopRef.current()) return
      if (engine.getState().lengthMs === 0) return
      const keys = keysRef.current
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = event.shiftKey ? NUDGE_LARGE_MS : NUDGE_MS
        keys.nudge(event.key === 'ArrowLeft' ? -step : step)
        return
      }
      if (event.repeat) return
      if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        keys.addCut()
      } else if (event.key === ' ' && !isControl(event.target)) {
        event.preventDefault()
        keys.togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine, isTopRef, keysRef])

  const {
    save: confirmAndWrite,
    saving,
    error,
  } = useEditorSave({
    recording,
    confirm,
    onTrimmedElsewhere,
    failure: SOMETHING_WENT_WRONG,
  })
  const save = async () => {
    const state = current.current
    if (!canSave(state)) return
    const count = state.cuts.length + 1
    await confirmAndWrite(
      {
        title: SPLIT_CONFIRM_TITLE(count),
        message: SPLIT_CONFIRM_MESSAGE,
        action: SPLIT_CONFIRM_ACTION,
      },
      async () => {
        await splitRecording(db, recording.id, state.cuts)
        analytics.send('recording_split', {
          recording_id: recording.id,
          piece_count: countBucket(count),
          over_limit: state.overLimit,
        })
        onDone()
      },
    )
  }

  return {
    split,
    loaded,
    playing: moving,
    line,
    shownLineMs: moving ? shownLineMs : lineMs,
    canAdd,
    removes,
    pressMain,
    seekTo,
    skip,
    togglePlay,
    toggleCut,
    selectedPiece,
    togglePiece,
    moveCut,
    panBy,
    pinches,
    previous: () => {
      hold()
      apply({ type: 'previous' })
    },
    next: () => {
      hold()
      apply({ type: 'next' })
    },
    scrubStart,
    scrub,
    scrubEnd,
    scrubBy,
    nudge,
    stripBox,
    pinch,
    pxPerS,
    halfSpanMs,
    zoom: (direction) => zoomBy(direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP),
    canZoomIn: pxPerS !== null && pxPerS < MAX_PX_PER_S,
    canZoomOut: pxPerS !== null && pxPerS > minPxPerS(widthPx, spanMs),
    save,
    saving,
    error,
  }
}
