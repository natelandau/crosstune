import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { LOOP_LIMITS } from '../../api/vocabulary'
import { clamp } from '../../math'
import { useLatest } from '../../ui/useLatest'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { formatDuration, formatPreciseDuration } from '../../text/format'
import type { ShownPeaks } from './recordingRange'
import { Waveform } from './Waveform'
import { slicePeaks } from '../waveform/peaks'
import { LoopHandle } from './LoopHandle'
import {
  roomAround,
  type Bounds,
  type Draft,
  type PlacedLoop,
  type Span,
} from '../../domain/loopModel'
import { LANES_LABEL, LOOP_NAME } from './practiceCopy'
import { msAtX, viewAt, xOfMs } from './practiceZoom'
import { AUTO_PAN_ZONE_PX } from './useAutoPan'
import { useScrub } from './useScrub'

/** `label` is the stored one, null when unnamed; `name` is what shows, a fallback included. */
export type LaneLoop = PlacedLoop & { name: string; label: string | null }

export interface SelectedLoop {
  id: string
  name: string
  color: number
  span: Span
}

/** What practice needs of a scrub under way, so its commands act where the playhead shows. */
export interface WaveformScrub {
  /** Stops a glide under way where it has got to; true when there was one. */
  settleGlide: () => boolean
  /** Where a scrub or glide has the playhead (trimmed timeline), else null. */
  shownMs: () => number | null
}

export const ARROW_STEP_MS = 1000
export const ARROW_LARGE_STEP_MS = 5000

/** `0:58 of 3:00`, the playhead's place on the trimmed timeline. */
export function POSITION_TEXT(ms: number, lengthMs: number): string {
  return `${formatDuration(ms)} of ${formatDuration(lengthMs)}`
}

/** Tick spacings the ruler picks from, in ms. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000]
/** The least room a ruler label gets. */
const MIN_TICK_PX = 56
/** Half a handle's 44 px target, so a name tab never sits under its loop's start handle. */
const TAB_INSET_PX = 22
/** The name field's width, which it keeps inside the waveform near the right edge. */
const RENAME_FIELD_PX = 160

const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-ARROW_STEP_MS, -ARROW_LARGE_STEP_MS],
  ArrowDown: [-ARROW_STEP_MS, -ARROW_LARGE_STEP_MS],
  ArrowRight: [ARROW_STEP_MS, ARROW_LARGE_STEP_MS],
  ArrowUp: [ARROW_STEP_MS, ARROW_LARGE_STEP_MS],
}

/**
 * The recording at one scale, centered on a fixed playhead. A drag scrolls the audio under the
 * playhead, which is the seek; a tap reports where it landed so the caller can pick the loop
 * there. Every loop shows as a tint with a name tab, and the selected loop's edges are handles.
 * Before the start and after the end the view stays blank rather than clamping.
 */
export function PracticeWaveform({
  shown,
  loops,
  selected,
  pxPerS,
  widthPx,
  bounds,
  playheadMs,
  renamingId,
  onTap,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDraft,
  onCommit,
  pinches,
  scrubRef,
  onScrubbing,
}: {
  shown: ShownPeaks | null
  loops: readonly LaneLoop[]
  /** The selected loop as shown, a draft ahead of its row included. */
  selected: SelectedLoop | null
  pxPerS: number
  widthPx: number
  /** The trim range on the source timeline. */
  bounds: Bounds
  /** On the source timeline. */
  playheadMs: number
  /** The loop whose name is being edited, if any. */
  renamingId: string | null
  /** `sourceMs` on the source timeline. */
  onTap: (sourceMs: number) => void
  onRenameStart: (id: string) => void
  onRenameCommit: (id: string, label: string) => void
  onRenameCancel: () => void
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  /** Counts pinches; a press that gave way to one neither seeks nor taps. */
  pinches: RefObject<number>
  /** Filled with this waveform's scrub while it is mounted. */
  scrubRef?: RefObject<WaveformScrub | null>
  /** Where a scrub or glide shows the playhead (trimmed timeline), null once it lets go. */
  onScrubbing?: (ms: number | null) => void
}) {
  const engine = usePlaybackEngine()
  const surface = useRef<HTMLDivElement>(null)
  const trimStartMs = bounds.startMs
  const lengthMs = bounds.endMs - bounds.startMs

  /** A tap `x` px from the left edge. It never scrubs, so its view is centered on the playhead. */
  const tapAt = (x: number) => {
    const tapped = viewAt(pxPerS, playheadMs - trimStartMs, widthPx, trimStartMs)
    onTap(Math.round(msAtX(tapped, x)))
  }
  const { scrubbingMs, handlers, settleGlide, shownMs } = useScrub({
    engine,
    pxPerS,
    lengthMs,
    pinches,
    onTap: (x, target) => {
      const tab = target instanceof Element ? target.closest<HTMLElement>('[data-name-tab]') : null
      if (selected && tab?.dataset.nameTab === selected.id) {
        onRenameStart(selected.id)
        return
      }
      tapAt(x)
    },
  })

  useLayoutEffect(() => {
    if (!scrubRef) return
    scrubRef.current = { settleGlide, shownMs }
    return () => {
      scrubRef.current = null
    }
  }, [scrubRef, settleGlide, shownMs])
  const onScrubbingRef = useLatest(onScrubbing)
  useEffect(() => onScrubbingRef.current?.(scrubbingMs), [scrubbingMs, onScrubbingRef])

  const centerMs = scrubbingMs ?? playheadMs - trimStartMs
  const view = viewAt(pxPerS, centerMs, widthPx, trimStartMs)
  const endMs = view.startMs + (widthPx / pxPerS) * 1000
  // Bars cover only the recording's own stretch, so the view past either end stays blank.
  const drawStartMs = Math.min(lengthMs, Math.max(0, view.startMs))
  const drawEndMs = Math.max(drawStartMs, Math.min(endMs, lengthMs))
  const peaks = useMemo(
    () => (shown ? slicePeaks(shown.peaks, drawStartMs, drawEndMs) : null),
    [shown, drawStartMs, drawEndMs],
  )

  const step = TICK_STEPS.find((ms) => (ms / 1000) * pxPerS >= MIN_TICK_PX) ?? 300_000
  const ticks: number[] = []
  const lastTick = Math.min(endMs, lengthMs)
  for (let t = Math.max(0, Math.ceil(view.startMs / step) * step); t <= lastTick; t += step) {
    ticks.push(t)
  }

  const seekBy = (deltaMs: number) =>
    engine.seek(clamp(engine.getState().positionMs + deltaMs, 0, lengthMs))
  /** Moves the playhead just far enough to bring a handle the keyboard reached into view. */
  const reveal = (sourceMs: number) => {
    const ms = sourceMs - trimStartMs
    const reach = ((widthPx / 2 - AUTO_PAN_ZONE_PX) / pxPerS) * 1000
    if (ms < centerMs - reach) engine.seek(clamp(ms + reach, 0, lengthMs))
    else if (ms > centerMs + reach) engine.seek(clamp(ms - reach, 0, lengthMs))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps = KEY_STEPS[event.key]
    let toMs: number | null = steps ? centerMs + steps[event.shiftKey ? 1 : 0] : null
    if (event.key === 'Home') toMs = 0
    if (event.key === 'End') toMs = lengthMs
    if (toMs === null) return
    event.preventDefault()
    settleGlide()
    engine.seek(clamp(toMs, 0, lengthMs))
  }

  const shownLoops = loops.map((loop) =>
    selected && loop.id === selected.id ? { ...loop, ...selected.span } : loop,
  )
  const room = selected
    ? roomAround(
        selected.span,
        loops.filter((loop) => loop.id !== selected.id),
        bounds,
      )
    : bounds

  return (
    <div
      ref={surface}
      data-practice-waveform
      data-start-ms={view.startMs}
      data-px-per-s={pxPerS}
      className="relative flex touch-none flex-col gap-1 select-none"
      {...handlers}
    >
      <div aria-hidden="true" className="t-caption relative h-4 overflow-hidden tabular-nums">
        {ticks.map((t) => (
          <span
            key={t}
            data-tick
            className="absolute top-0 border-l border-(--panel-muted) pl-1 leading-4 text-(--panel-muted)"
            style={{ left: ((t - view.startMs) / 1000) * pxPerS }}
          >
            {step < 1000 ? formatPreciseDuration(t) : formatDuration(t)}
          </span>
        ))}
      </div>
      <div className="relative">
        <div
          data-bars
          style={{
            marginLeft: ((drawStartMs - view.startMs) / 1000) * pxPerS,
            width: ((drawEndMs - drawStartMs) / 1000) * pxPerS,
          }}
        >
          <Waveform
            peaks={peaks}
            loudest={shown?.loudest}
            lengthMs={drawEndMs - drawStartMs}
            positionMs={centerMs - drawStartMs}
            heightClass="practice-detail"
            decorative
            onSeek={() => {}}
          />
        </div>
        {shownLoops.map((loop) => {
          const x0 = xOfMs(view, loop.startMs)
          const x1 = xOfMs(view, loop.endMs)
          if (x1 <= 0 || x0 >= widthPx) return null
          return (
            <div
              key={loop.id}
              aria-hidden="true"
              data-loop-tint={loop.id}
              data-color={loop.color}
              className="loop-color pointer-events-none absolute inset-y-0 bg-(--loop-tint)"
              style={{ left: Math.max(0, x0), right: widthPx - Math.min(widthPx, x1) }}
            />
          )
        })}
        <div
          role="slider"
          tabIndex={0}
          aria-label={LANES_LABEL}
          aria-valuemin={0}
          aria-valuemax={lengthMs}
          aria-valuenow={Math.round(centerMs)}
          aria-valuetext={POSITION_TEXT(centerMs, lengthMs)}
          className="absolute inset-0 cursor-grab rounded-md outline-offset-0"
          onKeyDown={onKeyDown}
        />
        {shownLoops.map((loop) => {
          const x0 = xOfMs(view, loop.startMs)
          const x1 = xOfMs(view, loop.endMs)
          if (x1 <= 0 || x0 >= widthPx) return null
          const left = Math.max(0, x0) + TAB_INSET_PX
          const style = { left, maxWidth: Math.max(0, Math.min(widthPx, x1) - TAB_INSET_PX - left) }
          if (loop.id === renamingId) {
            return (
              <RenameField
                key={loop.id}
                id={loop.id}
                label={loop.label}
                color={loop.color}
                left={Math.max(0, Math.min(left, widthPx - RENAME_FIELD_PX))}
                width={Math.min(RENAME_FIELD_PX, widthPx)}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
              />
            )
          }
          const tabClass = `loop-color t-secondary absolute top-0 truncate rounded-b-md bg-(--loop) px-2 py-1 font-semibold text-white`
          return loop.id === selected?.id ? (
            <button
              key={loop.id}
              type="button"
              data-name-tab={loop.id}
              data-color={loop.color}
              className={`${tabClass} z-10`}
              style={style}
              onClick={() => onRenameStart(loop.id)}
            >
              {loop.name}
            </button>
          ) : (
            <span
              key={loop.id}
              aria-hidden="true"
              data-name-tab={loop.id}
              data-color={loop.color}
              className={`${tabClass} pointer-events-none`}
              style={style}
            >
              {loop.name}
            </span>
          )
        })}
        <div
          aria-hidden="true"
          data-playhead
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-(--playhead)"
          style={{ left: widthPx / 2 }}
        />
        {selected
          ? (['start', 'end'] as const).map((edge) => (
              <LoopHandle
                key={`${selected.id}-${edge}`}
                edge={edge}
                id={selected.id}
                name={selected.name}
                color={selected.color}
                span={selected.span}
                view={view}
                bounds={room}
                playheadMs={playheadMs}
                surface={surface}
                onDraft={onDraft}
                onCommit={onCommit}
                onPan={seekBy}
                onReveal={reveal}
                // Like a tap on the waveform, one that lands during a glide only stops it.
                onTap={(x) => {
                  if (!settleGlide()) tapAt(x)
                }}
                pinches={pinches}
              />
            ))
          : null}
      </div>
    </div>
  )
}

/** The name tab as a text field: Enter or leaving it saves, Escape puts the name back. */
function RenameField({
  id,
  label,
  color,
  left,
  width,
  onCommit,
  onCancel,
}: {
  id: string
  label: string | null
  color: number
  left: number
  width: number
  onCommit: (id: string, label: string) => void
  onCancel: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  // Enter and Escape unmount the field, which can blur it again; only the first ending counts.
  const ended = useRef(false)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const end = (text: string | null) => {
    if (ended.current) return
    ended.current = true
    if (text === null) onCancel()
    else onCommit(id, text.trim())
  }
  return (
    <input
      ref={input}
      type="text"
      aria-label={LOOP_NAME}
      defaultValue={label ?? ''}
      maxLength={LOOP_LIMITS.label}
      data-color={color}
      className="loop-color t-secondary absolute top-0 z-20 h-8 rounded-b-md border border-(--loop) bg-(--panel-ground) px-2"
      style={{ left, width }}
      // The field takes its own presses, so selecting text never scrolls the audio.
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          end(event.currentTarget.value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          end(null)
        }
      }}
      onBlur={(event) => end(event.currentTarget.value)}
    />
  )
}
