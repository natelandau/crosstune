import { useMemo, useRef, type RefObject } from 'react'
import { stackRows, type Bounds, type PlacedLoop, type Span } from './loopModel'
import { xOfMs, type LaneView } from './practiceZoom'
import {
  LANE_PAD_PX,
  ROW_GAP_PX,
  ROW_HEIGHT_PX,
  useLoopGestures,
  type Draft,
} from './useLoopGestures'

export const LOOP_HINT = 'Drag here to mark a loop, or play and tap A B.'

/** Rows the lane shows before it scrolls. */
const SHOWN_ROWS = 3
/** The key a loop still being drawn goes under among the drafts. */
export const NEW_DRAFT = ''

export type LaneLoop = PlacedLoop & { name: string }

const rowTop = (row: number) => LANE_PAD_PX + row * (ROW_HEIGHT_PX + ROW_GAP_PX)
const heightFor = (rows: number) => rowTop(rows) - ROW_GAP_PX + LANE_PAD_PX

/**
 * A ruler-like track with each loop as a labeled bar, overlaps stacked into rows. Where the
 * musician draws, moves, resizes, and picks loops by pointer; the loop list is the way in for
 * the keyboard and assistive technology.
 */
export function LoopLane({
  loops,
  drafts,
  view,
  bounds,
  playheadMs,
  selectedId,
  canCreate,
  pinches,
  onDraft,
  onCommit,
  onSelect,
  onPan,
}: {
  loops: readonly LaneLoop[]
  /** Spans shown ahead of their rows, by loop id; `NEW_DRAFT` for one being drawn. */
  drafts: Readonly<Record<string, Span>>
  view: LaneView
  bounds: Bounds
  playheadMs: number
  selectedId: string | null
  canCreate: boolean
  pinches: RefObject<number>
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  onSelect: (id: string) => void
  onPan: (deltaMs: number) => void
}) {
  const lane = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => {
    const placed: LaneLoop[] = loops.map((loop) => {
      const draft = drafts[loop.id]
      return draft ? { ...loop, ...draft } : loop
    })
    const drawing = drafts[NEW_DRAFT]
    if (drawing) placed.push({ id: NEW_DRAFT, color: 0, name: '', ...drawing })
    return placed
  }, [loops, drafts])
  const rows = useMemo(() => stackRows(shown), [shown])
  const rowCount = Math.max(0, ...rows.values()) + (shown.length > 0 ? 1 : 0)

  const handlers = useLoopGestures({
    lane,
    view,
    loops: shown.filter((loop) => loop.id !== NEW_DRAFT),
    rows,
    bounds,
    playheadMs,
    canCreate,
    pinches,
    onDraft,
    onCommit,
    onSelect,
    onPan,
  })

  const playheadX = xOfMs(view, playheadMs)
  const contentHeight = Math.max(heightFor(SHOWN_ROWS), heightFor(rowCount))
  return (
    <div
      ref={lane}
      data-loop-lane
      data-start-ms={view.startMs}
      data-px-per-s={view.pxPerS}
      className="relative touch-none overflow-x-hidden overflow-y-auto rounded-lg bg-(--fill-tertiary) select-none"
      style={{ height: heightFor(SHOWN_ROWS) }}
      {...handlers}
    >
      <div className="relative" style={{ height: contentHeight }}>
        {shown.length === 0 && canCreate ? (
          <p className="type-footnote pointer-events-none absolute inset-0 m-0 grid place-items-center px-4 text-center text-(--ion-color-medium)">
            {LOOP_HINT}
          </p>
        ) : null}
        {shown.map((loop) => {
          const x0 = xOfMs(view, loop.startMs)
          const x1 = xOfMs(view, loop.endMs)
          if (x1 < 0 || x0 > view.widthPx) return null
          const selected = loop.id === selectedId
          const drawing = loop.id === NEW_DRAFT
          return (
            <div
              key={loop.id || 'new'}
              data-loop={drawing ? undefined : loop.id}
              data-loop-draft={drawing || undefined}
              data-row={rows.get(loop.id)}
              data-selected={selected}
              data-color={loop.color}
              className={`loop-color type-caption pointer-events-none absolute flex items-center overflow-hidden rounded-md border px-1 whitespace-nowrap ${
                selected
                  ? 'border-(--loop) bg-(--loop) text-white'
                  : drawing
                    ? 'border-dashed border-(--ion-color-medium) bg-(--fill-tertiary)'
                    : 'border-(--loop) bg-(--loop-tint)'
              }`}
              style={{
                left: x0,
                width: Math.max(2, x1 - x0),
                top: rowTop(rows.get(loop.id) ?? 0),
                height: ROW_HEIGHT_PX,
              }}
            >
              <span className="truncate">{loop.name}</span>
            </div>
          )
        })}
        {playheadX >= 0 && playheadX <= view.widthPx ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--ion-text-color)"
            style={{ left: playheadX }}
          />
        ) : null}
      </div>
    </div>
  )
}
