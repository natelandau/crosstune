import { ZoomIn, ZoomOut } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { addLoop, updateLoop } from '../../commands/loops'
import { LOOP_LIMIT, RECORDING_NOT_FOUND } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import { isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { formatDuration } from '../recording/format'
import { PANEL_ICON_BUTTON, PANEL_TEXT_BUTTON } from '../recording-screen/panel'
import { trimmedLengthMs, type ShownPeaks } from '../recording-screen/recordingRange'
import { ZOOM_IN, ZOOM_OUT } from '../recording-screen/TrimView'
import { useZoomGestures } from '../recording-screen/useZoomGestures'
import type { RecordingView } from '../recordings/useRecordings'
import { DetailWaveform } from './DetailWaveform'
import { canCreate, loopName, type Span } from './loopModel'
import { LoopLane, NEW_DRAFT, type LaneLoop } from './LoopLane'
import { OverviewStrip } from './OverviewStrip'
import {
  clampZoom,
  fitSpan,
  MAX_PX_PER_S,
  minPxPerS,
  openingZoom,
  pageToKeep,
  panBy,
  visibleSpan,
  zoomBy,
  type LaneView,
  type ZoomFrame,
  type ZoomState,
} from './practiceZoom'
import type { Draft } from './useLoopGestures'
import type { LoopPlayback } from './useLoopPlayback'

export const FIT = 'Fit'
export const LOOP_NOT_SAVED = 'The loop could not be saved.'

/** How far one press of a zoom button or key zooms. */
const ZOOM_STEP = 2

const sameSpan = (row: LocalRecordingLoop, span: Span) =>
  row.start_ms === span.startMs && row.end_ms === span.endMs

/**
 * The overview, the loop lane, and the zoomed waveform, sharing one zoom: a scale and a center
 * that Fit, the zoom buttons and keys, a pinch, and the overview all move. Every drag shows as
 * a draft until its one write lands in the row.
 */
export function PracticeLanes({
  view,
  shown,
  loops,
  playback,
  band,
  modal,
  fitRef,
  onError,
}: {
  view: RecordingView
  shown: ShownPeaks | null
  loops: LocalRecordingLoop[] | undefined
  playback: LoopPlayback
  /** A B's mark, drawn like a loop being drawn while no drag is drawing one. */
  band: Span | null
  modal: RefObject<HTMLIonModalElement | null>
  /** Set to what frames a span (source timeline) in the zoomed view, for a loop chosen elsewhere. */
  fitRef?: RefObject<((span: Span) => void) | null>
  onError: (message: string) => void
}) {
  const { recording, file } = view
  const db = useDb()
  const engine = usePlaybackEngine()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const trimStartMs = recording.trim_start_ms
  const loaded = state.lengthMs > 0
  const lengthMs = loaded ? state.lengthMs : (trimmedLengthMs(recording, file) ?? 0)
  const positionMs = loaded ? state.positionMs : 0
  const playheadMs = trimStartMs + positionMs
  const bounds = useMemo(
    () => ({ startMs: trimStartMs, endMs: trimStartMs + lengthMs }),
    [trimStartMs, lengthMs],
  )

  const column = useRef<HTMLDivElement>(null)
  const [widthPx, setWidthPx] = useState(0)
  useEffect(() => {
    const element = column.current
    if (!element) return
    // An observer reports the size it starts with, so this also takes the first measurement.
    const observer = new ResizeObserver(() => setWidthPx(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const frame = { widthPx, lengthMs }

  const rows = useMemo(() => loops ?? [], [loops])
  const selectedRow = rows.find((loop) => loop.id === playback.selectedId) ?? null
  // Each draft keeps the row's span from when it was drawn as `base`. It gives way once its row
  // holds the drafted span or has moved off `base` (a write, this view's or a newer one, has
  // landed), so a write never flickers back and a newer value is never hidden. The draft a
  // gesture is still drawing waits for the gesture to end.
  const [drafts, setDrafts] = useState<Record<string, { span: Span; base: Span | null }>>({})
  const active = useRef<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const landed = Object.keys(drafts).filter((id) => {
    const row = rows.find((loop) => loop.id === id)
    if (!row) return false
    const { span, base } = drafts[id]!
    return sameSpan(row, span) || (id !== activeKey && (!base || !sameSpan(row, base)))
  })
  if (landed.length > 0) {
    setDrafts((current) => {
      const next = { ...current }
      for (const id of landed) delete next[id]
      return next
    })
  }
  const shownDrafts = useMemo(() => {
    const shown: Record<string, Span> = Object.fromEntries(
      Object.entries(drafts).map(([id, { span }]) => [id, span]),
    )
    if (band && !(NEW_DRAFT in shown)) shown[NEW_DRAFT] = band
    return shown
  }, [drafts, band])
  const putDraft = (key: string, span: Span) => {
    const row = rows.find((loop) => loop.id === key)
    const base = row ? { startMs: row.start_ms, endMs: row.end_ms } : null
    setDrafts((current) => ({ ...current, [key]: { span, base: current[key]?.base ?? base } }))
  }

  const laneLoops = useMemo<LaneLoop[]>(
    () =>
      rows.map((loop) => ({
        id: loop.id,
        startMs: loop.start_ms,
        endMs: loop.end_ms,
        color: loop.color,
        name: loopName(loop.label ?? null, loop.start_ms, trimStartMs),
      })),
    [rows, trimStartMs],
  )

  const [zoom, setZoom] = useState<ZoomState | null>(null)
  const trimmed = (span: Span): Span => ({
    startMs: span.startMs - trimStartMs,
    endMs: span.endMs - trimStartMs,
  })
  if (!zoom && widthPx > 0 && lengthMs > 0 && loops !== undefined) {
    const loop = selectedRow
      ? trimmed({ startMs: selectedRow.start_ms, endMs: selectedRow.end_ms })
      : null
    setZoom(openingZoom(loop, positionMs, frame))
  }
  const current = zoom && widthPx > 0 && lengthMs > 0 ? clampZoom(zoom, frame) : null

  // The view stays still while the playhead moves through it, and turns a page only when the
  // playhead leaves it, so a repeating loop never moves the screen. A playhead the musician
  // panned away from is left alone until it comes back into view.
  const [lastPositionMs, setLastPositionMs] = useState(positionMs)
  if (lastPositionMs !== positionMs) {
    setLastPositionMs(positionMs)
    if (current && state.playing) {
      const { startMs, endMs } = visibleSpan(current, widthPx)
      const inside = (ms: number) => ms >= startMs && ms <= endMs
      if (inside(lastPositionMs) && !inside(positionMs)) {
        setZoom(clampZoom(pageToKeep(current, positionMs, widthPx), frame))
      }
    }
  }

  const latest = useRef({ current, frame, positionMs, drafts })
  useLayoutEffect(() => {
    latest.current = { current, frame, positionMs, drafts }
  })
  // Each change builds on the zoom as it now stands, so several in one frame (the moves of a
  // fast drag) add up rather than each starting from the last render.
  const update = (change: (zoom: ZoomState, frame: ZoomFrame) => ZoomState) => {
    const { frame } = latest.current
    if (frame.widthPx <= 0 || frame.lengthMs <= 0) return
    setZoom((zoom) => (zoom ? change(clampZoom(zoom, frame), frame) : zoom))
  }
  const zoomAround = (factor: number, anchorMs?: number) =>
    update((zoom, frame) => {
      const { positionMs } = latest.current
      const { startMs, endMs } = visibleSpan(zoom, frame.widthPx)
      const anchor =
        anchorMs ?? (positionMs >= startMs && positionMs <= endMs ? positionMs : zoom.centerMs)
      return zoomBy(zoom, factor, anchor, frame)
    })
  const pan = (deltaMs: number) => update((zoom, frame) => panBy(zoom, deltaMs, frame))
  const center = (ms: number) =>
    update((zoom, frame) => clampZoom({ ...zoom, centerMs: ms }, frame))
  const reveal = (sourceMs: number) =>
    update((zoom, frame) => {
      const ms = sourceMs - trimStartMs
      const { startMs, endMs } = visibleSpan(zoom, frame.widthPx)
      return ms < startMs || ms > endMs ? clampZoom({ ...zoom, centerMs: ms }, frame) : zoom
    })
  const fit = () => {
    if (!current) return
    setZoom(
      clampZoom(
        selectedRow
          ? fitSpan(trimmed({ startMs: selectedRow.start_ms, endMs: selectedRow.end_ms }), widthPx)
          : { pxPerS: minPxPerS(widthPx, lengthMs), centerMs: lengthMs / 2 },
        frame,
      ),
    )
  }

  useLayoutEffect(() => {
    if (!fitRef) return
    fitRef.current = (span) =>
      update((_, frame) => clampZoom(fitSpan(trimmed(span), frame.widthPx), frame))
  })
  useLayoutEffect(() => {
    if (!fitRef) return
    return () => {
      fitRef.current = null
    }
  }, [fitRef])

  const keys = useRef(zoomAround)
  useLayoutEffect(() => {
    keys.current = zoomAround
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const factor =
        event.key === '=' || event.key === '+' ? ZOOM_STEP : event.key === '-' ? 1 / ZOOM_STEP : 0
      if (factor === 0 || isTextEntry(event.target) || !isTopOverlay(modal.current)) return
      // Otherwise the browser zooms the whole page.
      event.preventDefault()
      keys.current(factor)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  const zoomArea = useRef<HTMLDivElement>(null)
  const beforePinch = useRef<ZoomState | null>(null)
  const pinches = useRef(0)
  const pinch = useZoomGestures(zoomArea, (action) => zoomAround(action.factor, action.centerMs), {
    onFirstPointer: () => {
      beforePinch.current = latest.current.current
    },
    onPinchStart: () => {
      if (beforePinch.current) setZoom(beforePinch.current)
      pinches.current += 1
    },
    msAt: (clientX) => {
      const { current, frame } = latest.current
      const left = zoomArea.current?.getBoundingClientRect().left ?? 0
      if (!current) return 0
      return (
        visibleSpan(current, frame.widthPx).startMs + ((clientX - left) / current.pxPerS) * 1000
      )
    },
  })

  const create = canCreate(rows.length, bounds)
  const report = (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    onError(error instanceof Error && error.message === LOOP_LIMIT ? LOOP_LIMIT : LOOP_NOT_SAVED)
  }
  const dropDraft = (key: string) =>
    setDrafts((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })

  const setActive = (key: string | null) => {
    active.current = key
    setActiveKey(key)
  }
  const onDraft = (draft: Draft | null) => {
    if (!draft) {
      const key = active.current
      setActive(null)
      if (key === null) return
      dropDraft(key)
      if (key === playback.selectedId) playback.hold(key, null)
      return
    }
    const key = draft.id ?? NEW_DRAFT
    setActive(key)
    const span = { startMs: draft.startMs, endMs: draft.endMs }
    putDraft(key, span)
    // A repeating loop follows the drag while the playhead stays inside it; one dragged off
    // the playhead takes it along on release.
    if (draft.id !== null && draft.id === playback.selectedId) {
      if (playheadMs >= span.startMs && playheadMs < span.endMs) playback.hold(draft.id, span)
    }
  }

  const onCommit = (draft: Draft) => {
    setActive(null)
    const span = { startMs: draft.startMs, endMs: draft.endMs }
    const id = draft.id
    if (id === null) {
      if (!create.allowed) {
        dropDraft(NEW_DRAFT)
        return
      }
      putDraft(NEW_DRAFT, span)
      addLoop(db, recording.id, { start_ms: span.startMs, end_ms: span.endMs }).then(
        (created) => {
          setDrafts((current) => {
            const next = { ...current, [created]: { span, base: null } }
            delete next[NEW_DRAFT]
            return next
          })
          playback.select(created)
        },
        (error: unknown) => {
          dropDraft(NEW_DRAFT)
          report(error)
        },
      )
      return
    }
    const row = rows.find((loop) => loop.id === id)
    if (!row || sameSpan(row, span)) {
      dropDraft(id)
      if (id === playback.selectedId) playback.hold(id, null)
      return
    }
    putDraft(id, span)
    if (id === playback.selectedId) playback.hold(id, span)
    const letGo = () => {
      dropDraft(id)
      if (id === playback.selectedId) playback.hold(id, null)
    }
    updateLoop(db, id, { start_ms: span.startMs, end_ms: span.endMs })
      .then(async () => {
        // A write that changed nothing (its row deleted meanwhile, say) never lands in the
        // row, so its draft would otherwise wait forever. A newer draft is left alone.
        const stored = await db.recording_loops.get(id)
        if (stored && !stored.deleted_at && sameSpan(stored, span)) return
        const draft = latest.current.drafts[id]?.span
        if (draft && draft.startMs === span.startMs && draft.endMs === span.endMs) letGo()
      })
      .catch((error: unknown) => {
        letGo()
        report(error)
      })
  }

  const laneView: LaneView | null = current
    ? {
        startMs: visibleSpan(current, widthPx).startMs,
        pxPerS: current.pxPerS,
        widthPx,
        trimStartMs,
      }
    : null
  const selected = selectedRow
    ? {
        id: selectedRow.id,
        name: loopName(selectedRow.label ?? null, selectedRow.start_ms, trimStartMs),
        color: selectedRow.color,
        span: drafts[selectedRow.id]?.span ?? {
          startMs: selectedRow.start_ms,
          endMs: selectedRow.end_ms,
        },
      }
    : null
  const snapTargets = useMemo(() => {
    const targets = [playheadMs]
    for (const loop of rows) {
      if (loop.id !== playback.selectedId) targets.push(loop.start_ms, loop.end_ms)
    }
    return targets
  }, [rows, playheadMs, playback.selectedId])

  return (
    <div ref={column} className="flex flex-col gap-3">
      {current && laneView ? (
        <OverviewStrip
          shown={shown}
          lengthMs={lengthMs}
          trimStartMs={trimStartMs}
          visible={visibleSpan(current, widthPx)}
          loops={laneLoops}
          playheadMs={playheadMs}
          selectedId={playback.selectedId}
          onCenter={center}
          onPan={pan}
        />
      ) : null}
      <div ref={zoomArea} className="flex flex-col gap-2" {...pinch}>
        {laneView ? (
          <>
            <LoopLane
              loops={laneLoops}
              drafts={shownDrafts}
              view={laneView}
              bounds={bounds}
              playheadMs={playheadMs}
              selectedId={playback.selectedId}
              canCreate={create.allowed}
              pinches={pinches}
              onDraft={onDraft}
              onCommit={onCommit}
              onSelect={playback.select}
              onPan={pan}
            />
            {create.reason ? (
              <p className="type-footnote m-0 text-(--ion-color-medium)">{create.reason}</p>
            ) : null}
            <DetailWaveform
              shown={shown}
              view={laneView}
              bounds={bounds}
              playheadMs={playheadMs}
              selected={selected}
              snapTargets={snapTargets}
              onSeek={(ms) => engine.seek(ms)}
              onPan={pan}
              onDraft={onDraft}
              onCommit={onCommit}
              onReveal={reveal}
              pinches={pinches}
            />
          </>
        ) : null}
      </div>
      {current ? (
        <div className="flex items-center gap-2">
          <span className="type-footnote tabular-nums">{formatDuration(positionMs)}</span>
          <span className="type-footnote min-w-0 flex-1 truncate text-center tabular-nums">
            {selected
              ? `${selected.name} · ${formatDuration(selected.span.startMs - trimStartMs)}–${formatDuration(selected.span.endMs - trimStartMs)}`
              : null}
          </span>
          <button type="button" className={PANEL_TEXT_BUTTON} onClick={fit}>
            {FIT}
          </button>
          <button
            type="button"
            aria-label={ZOOM_OUT}
            className={PANEL_ICON_BUTTON}
            disabled={current.pxPerS <= minPxPerS(widthPx, lengthMs)}
            onClick={() => zoomAround(1 / ZOOM_STEP)}
          >
            <ZoomOut aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label={ZOOM_IN}
            className={PANEL_ICON_BUTTON}
            disabled={current.pxPerS >= MAX_PX_PER_S}
            onClick={() => zoomAround(ZOOM_STEP)}
          >
            <ZoomIn aria-hidden="true" className="size-5" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
