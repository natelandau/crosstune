import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { LOOP_LIMITS } from '../../api/vocabulary'
import { clamp } from '../../math'
import { useLatest } from '../../ui/useLatest'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { formatDuration, formatPreciseDuration } from '../../text/format'
import type { ShownPeaks } from './recordingRange'
import { ZoomedWaveformBars } from './ZoomedWaveformBars'
import { LoopHandle } from './LoopHandle'
import {
  roomAround,
  type Bounds,
  type Draft,
  type PlacedLoop,
  type Span,
} from '../../domain/loopModel'
import { WAVEFORM_LABEL, LOOP_NAME } from './practiceCopy'
import type { Moving, PlayheadClock } from '../player/playheadClock'
import { msAtX, viewAt, xOfMs, type ZoomedViewSource } from './practiceZoom'
import { AUTO_PAN_ZONE_PX } from './useAutoPan'
import { useScrub } from './useScrub'

/** `label` is the stored one, null when unnamed; `name` is what shows, a fallback included. */
export type WaveformLoop = PlacedLoop & { name: string; label: string | null }

export interface SelectedLoop {
  id: string
  name: string
  color: number
  span: Span
}

/** What practice needs of a scrub under way, so its commands act where the playhead shows. */
export interface WaveformScrub {
  /** Stops a momentum scroll under way where it has got to; true when there was one. */
  settleMomentumScroll: () => boolean
  /** Where a scrub or momentum scroll has the playhead (trimmed timeline), else null. */
  shownMs: () => number | null
}

export const ARROW_STEP_MS = 1000
export const ARROW_LARGE_STEP_MS = 5000

/** `0:58 of 3:00`, the playhead's place on the trimmed timeline. */
function POSITION_TEXT(ms: number, lengthMs: number): string {
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
 *
 * The view follows `playhead` every frame outside React: the bars redraw, the ruler and tints
 * slide on a transform, and the tabs and handles take their place. React renders only when the
 * loops, the selection, the scale, or the stretch of ruler laid out changes.
 */
export function PracticeWaveform({
  shown,
  loops,
  selected,
  pxPerS,
  widthPx,
  bounds,
  playhead,
  renamingId,
  onTap,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDraft,
  onCommit,
  pinches,
  scrubRef,
}: {
  shown: ShownPeaks | null
  loops: readonly WaveformLoop[]
  /** The selected loop as shown, a draft ahead of its row included. */
  selected: SelectedLoop | null
  pxPerS: number
  widthPx: number
  /** The trim range on the source timeline. */
  bounds: Bounds
  /** Where the playhead is drawn; a scrub here reports to it. */
  playhead: PlayheadClock
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
}) {
  const engine = usePlaybackEngine()
  const surface = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLDivElement>(null)
  const tickTrack = useRef<HTMLDivElement>(null)
  const tintTrack = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Map<string, HTMLElement>())
  const trimStartMs = bounds.startMs
  const lengthMs = bounds.endMs - bounds.startMs

  const zoomedView = useMemo<ZoomedViewSource>(
    () => ({
      trimStartMs,
      view: () => viewAt(pxPerS, playhead.ms, widthPx, trimStartMs),
      subscribe: playhead.subscribe,
    }),
    [playhead, pxPerS, widthPx, trimStartMs],
  )
  const viewStart = useMemo<Moving<number>>(
    () => ({ get: () => zoomedView.view().startMs, subscribe: zoomedView.subscribe }),
    [zoomedView],
  )

  /** A tap `x` px from the left edge, on the view as drawn. */
  const tapAt = (x: number) => onTap(Math.round(msAtX(zoomedView.view(), x)))
  const { handlers, settleMomentumScroll, shownMs } = useScrub({
    engine,
    position: playhead.live,
    pxPerS,
    lengthMs,
    pinches,
    onShow: playhead.setScrub,
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
    scrubRef.current = { settleMomentumScroll, shownMs }
    return () => {
      scrubRef.current = null
    }
  }, [scrubRef, settleMomentumScroll, shownMs])

  // The ruler is laid out a view's width either side of `anchorMs`, so it slides a half view
  // either way before it needs laying out again.
  const spanMs = (widthPx / pxPerS) * 1000
  const [anchorMs, setAnchorMs] = useState(() => playhead.ms)
  const step = TICK_STEPS.find((ms) => (ms / 1000) * pxPerS >= MIN_TICK_PX) ?? 300_000
  const ticks: number[] = []
  const lastTick = Math.min(anchorMs + spanMs, lengthMs)
  for (
    let t = Math.max(0, Math.ceil((anchorMs - spanMs) / step) * step);
    t <= lastTick;
    t += step
  ) {
    ticks.push(t)
  }
  /** The x of a trimmed time on the sliding tracks. */
  const trackX = (ms: number) => (ms / 1000) * pxPerS

  const seekBy = (deltaMs: number) => engine.seek(clamp(playhead.ms + deltaMs, 0, lengthMs))
  /** Moves the playhead just far enough to bring a handle the keyboard reached into view. */
  const reveal = (sourceMs: number) => {
    const ms = sourceMs - trimStartMs
    const centerMs = playhead.ms
    const reach = ((widthPx / 2 - AUTO_PAN_ZONE_PX) / pxPerS) * 1000
    if (ms < centerMs - reach) engine.seek(clamp(ms + reach, 0, lengthMs))
    else if (ms > centerMs + reach) engine.seek(clamp(ms - reach, 0, lengthMs))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps = KEY_STEPS[event.key]
    let toMs: number | null = steps ? playhead.ms + steps[event.shiftKey ? 1 : 0] : null
    if (event.key === 'Home') toMs = 0
    if (event.key === 'End') toMs = lengthMs
    if (toMs === null) return
    event.preventDefault()
    settleMomentumScroll()
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

  /** Puts everything that moves with the playhead where the view now has it. */
  const placeRef = useLatest(() => {
    const view = zoomedView.view()
    const centerMs = playhead.ms
    surface.current?.setAttribute('data-start-ms', String(view.startMs))
    const scale = window.devicePixelRatio || 1
    // On whole device pixels, so the ruler's hairlines stay sharp as they slide.
    const shift = `translateX(${Math.round(-trackX(view.startMs) * scale) / scale}px)`
    if (tickTrack.current) tickTrack.current.style.transform = shift
    if (tintTrack.current) tintTrack.current.style.transform = shift
    const text = POSITION_TEXT(centerMs, lengthMs)
    const range = slider.current
    // While playing, the slider's value changes only as often as its words do.
    if (range && (!playhead.running || range.getAttribute('aria-valuetext') !== text)) {
      range.setAttribute('aria-valuenow', String(Math.round(centerMs)))
      range.setAttribute('aria-valuetext', text)
    }
    for (const loop of shownLoops) {
      const tab = tabs.current.get(loop.id)
      if (!tab) continue
      const x0 = xOfMs(view, loop.startMs)
      const x1 = xOfMs(view, loop.endMs)
      const off = x1 <= 0 || x0 >= widthPx
      tab.style.display = off ? 'none' : ''
      if (off) continue
      const left = Math.max(0, x0) + TAB_INSET_PX
      if (loop.id === renamingId) {
        tab.style.left = `${Math.max(0, Math.min(left, widthPx - RENAME_FIELD_PX))}px`
      } else {
        tab.style.left = `${left}px`
        tab.style.maxWidth = `${Math.max(0, Math.min(widthPx, x1) - TAB_INSET_PX - left)}px`
      }
    }
    if (Math.abs(centerMs - anchorMs) > spanMs / 2) setAnchorMs(centerMs)
  })
  useLayoutEffect(() => placeRef.current())
  useLayoutEffect(() => zoomedView.subscribe(() => placeRef.current()), [zoomedView, placeRef])

  const tabRef = (id: string) => (element: HTMLElement | null) => {
    if (element) tabs.current.set(id, element)
    else tabs.current.delete(id)
  }

  return (
    <div
      ref={surface}
      data-practice-waveform
      data-px-per-s={pxPerS}
      className="relative flex touch-none flex-col gap-1 select-none"
      {...handlers}
    >
      <div aria-hidden="true" className="t-caption relative h-4 overflow-hidden tabular-nums">
        <div ref={tickTrack} className="absolute inset-y-0 left-0">
          {ticks.map((t) => (
            <span
              key={t}
              data-tick
              className="border-on-practice-secondary text-on-practice-secondary absolute top-0 border-l pl-1 leading-4 whitespace-nowrap"
              style={{ left: trackX(t) }}
            >
              {step < 1000 ? formatPreciseDuration(t) : formatDuration(t)}
            </span>
          ))}
        </div>
      </div>
      <div className="relative">
        <ZoomedWaveformBars
          shown={shown}
          startMs={viewStart}
          pxPerS={pxPerS}
          lengthMs={lengthMs}
          heightClass="practice-detail"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={tintTrack} className="absolute inset-y-0 left-0">
            {shownLoops.map((loop) => (
              <div
                key={loop.id}
                data-loop-tint={loop.id}
                data-color={loop.color}
                className="loop-color absolute inset-y-0 bg-(--loop-tint)"
                style={{
                  left: trackX(loop.startMs - trimStartMs),
                  width: trackX(loop.endMs - loop.startMs),
                }}
              />
            ))}
          </div>
        </div>
        <div
          ref={slider}
          role="slider"
          tabIndex={0}
          aria-label={WAVEFORM_LABEL}
          aria-valuemin={0}
          aria-valuemax={lengthMs}
          className="absolute inset-0 cursor-grab rounded-md outline-offset-0"
          onKeyDown={onKeyDown}
        />
        {shownLoops.map((loop) => {
          if (loop.id === renamingId) {
            return (
              <RenameField
                key={loop.id}
                id={loop.id}
                label={loop.label}
                color={loop.color}
                width={Math.min(RENAME_FIELD_PX, widthPx)}
                fieldRef={tabRef(loop.id)}
                onCommit={onRenameCommit}
                onCancel={onRenameCancel}
              />
            )
          }
          const tabClass = `loop-color t-secondary absolute top-0 truncate rounded-b-md bg-(--loop) px-2 py-1 font-semibold text-on-practice`
          return loop.id === selected?.id ? (
            <button
              key={loop.id}
              ref={tabRef(loop.id)}
              type="button"
              data-name-tab={loop.id}
              data-color={loop.color}
              className={`${tabClass} z-10`}
              onClick={() => onRenameStart(loop.id)}
            >
              {loop.name}
            </button>
          ) : (
            <span
              key={loop.id}
              ref={tabRef(loop.id)}
              aria-hidden="true"
              data-name-tab={loop.id}
              data-color={loop.color}
              className={`${tabClass} pointer-events-none`}
            >
              {loop.name}
            </span>
          )
        })}
        <div
          aria-hidden="true"
          data-playhead
          className="bg-brand pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2"
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
                zoomedView={zoomedView}
                bounds={room}
                playheadMs={() => trimStartMs + playhead.ms}
                surface={surface}
                onDraft={onDraft}
                onCommit={onCommit}
                onPan={seekBy}
                onReveal={reveal}
                // Like a tap on the waveform, one that lands during a momentum scroll only stops it.
                onTap={(x) => {
                  if (!settleMomentumScroll()) tapAt(x)
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
  width,
  fieldRef,
  onCommit,
  onCancel,
}: {
  id: string
  label: string | null
  color: number
  width: number
  /** Takes the field, which practice places as the view moves. */
  fieldRef: (element: HTMLInputElement | null) => void
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
      ref={(element) => {
        input.current = element
        fieldRef(element)
      }}
      type="text"
      aria-label={LOOP_NAME}
      defaultValue={label ?? ''}
      maxLength={LOOP_LIMITS.label}
      data-color={color}
      className="loop-color t-secondary bg-practice-background absolute top-0 z-20 h-8 rounded-b-md border border-(--loop) px-2"
      style={{ width }}
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
