import type { CSSProperties, ReactNode } from 'react'
import type { PlaybackEngine } from '../player/playbackEngine'
import { clamp } from '../../math'
import { adjacent, newLoop, placedLoop } from '../../domain/loopModel'
import { usePlayheadWhere } from '../player/playheadClock'
import type { ShownPeaks } from './recordingRange'
import { Waveform } from './Waveform'
import { LoopsPanel } from './LoopsPanel'
import { LoopSwitcher } from './LoopSwitcher'
import { OverviewStrip } from './OverviewStrip'
import { PracticeWaveform } from './PracticeWaveform'
import type { PracticeCore } from './usePracticeCore'
import type { PracticeLoops } from './usePracticeLoops'
import type { PracticeTimeline } from './usePracticeTimeline'

/** The waveform's ruler and the gap under it, which the bars' height leaves room for. */
const RULER_PX = 20

const offClass = (blocked?: string) => (blocked ? 'pointer-events-none opacity-50' : '')

/** The whole take with the view's window on it, or a plain bar until there is a length. */
export function PracticeOverview({
  timeline,
  loops,
  shown,
  blocked,
}: {
  timeline: PracticeTimeline
  loops: PracticeLoops
  shown: ShownPeaks | null
  blocked?: string
}) {
  return (
    <div inert={!!blocked} className={offClass(blocked)}>
      {timeline.halfSpanMs !== null ? (
        <OverviewStrip
          shown={shown}
          lengthMs={timeline.lengthMs}
          trimStartMs={timeline.bounds.startMs}
          halfSpanMs={timeline.halfSpanMs}
          loops={loops.laneLoops}
          playhead={timeline.playhead}
          selectedId={loops.playback.selectedId}
          onSeek={timeline.seek}
        />
      ) : (
        <div data-overview data-timeline-bar>
          <TimelineBar heightClass="h-5" />
        </div>
      )}
    </div>
  )
}

/**
 * The zoomed waveform under the fixed playhead. It takes whatever the controls below leave,
 * which never changes with the mode or the loops, so its height holds still. `children` sit
 * over it as siblings, so a press on them never reaches its scrub, tap, pinch, or handle drag.
 */
export function PracticeWaveformSlot({
  timeline,
  loops,
  size,
  slotRef,
  pinch,
  pinches,
  shown,
  blocked,
  children,
}: Pick<PracticeCore, 'timeline' | 'loops' | 'size' | 'pinch' | 'pinches'> & {
  slotRef: PracticeCore['slot']
  shown: ShownPeaks | null
  blocked?: string
  children?: ReactNode
}) {
  return (
    <div className="relative min-h-[160px] flex-1">
      <div
        ref={slotRef}
        inert={!!blocked}
        className={`absolute inset-0 ${offClass(blocked)}`}
        style={
          {
            '--practice-detail-height': `${Math.max(0, size.height - RULER_PX)}px`,
          } as CSSProperties
        }
        {...pinch}
      >
        {timeline.pxPerS ? (
          <div className="absolute inset-0">
            <PracticeWaveform
              shown={shown}
              loops={loops.laneLoops}
              selected={loops.selected}
              pxPerS={timeline.pxPerS}
              widthPx={size.width}
              bounds={timeline.bounds}
              playhead={timeline.playhead}
              renamingId={loops.renamingId}
              onTap={loops.onTap}
              onRenameStart={loops.startRename}
              onRenameCommit={loops.commitRename}
              onRenameCancel={loops.endRename}
              onDraft={loops.onDraft}
              onCommit={loops.onCommit}
              pinches={pinches}
              scrubRef={timeline.scrub}
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
      {children}
    </div>
  )
}

/** Previous and Next loop under the transport. */
export function PracticeLoopSwitcher({
  timeline,
  loops,
  engine,
  disabled,
}: {
  timeline: PracticeTimeline
  loops: PracticeLoops
  engine: PlaybackEngine
  disabled: boolean
}) {
  const trimStartMs = timeline.bounds.startMs
  const placed = loops.rows.map(placedLoop)
  const selectedId = loops.playback.selectedId
  // The arrows depend on the playhead only through the loops either side of it.
  const playheadMs = sourceMs(
    timeline,
    usePlayheadWhere(timeline.playhead, (ms) => {
      const atMs = sourceMs(timeline, ms)
      const previous = adjacent('previous', atMs, placed, selectedId)?.id
      return `${previous ?? ''}|${adjacent('next', atMs, placed, selectedId)?.id ?? ''}`
    }),
  )
  return (
    <LoopSwitcher
      loops={loops.rows}
      playback={loops.playback}
      playheadMs={playheadMs}
      trimStartMs={trimStartMs}
      disabled={disabled}
      onCommand={timeline.settle}
      // The playhead is the view's center, so the loop's start comes to it.
      onReveal={(span) => engine.seek(span.startMs - trimStartMs)}
      announce={timeline.announce}
    />
  )
}

/** The Loops mode's panel. */
export function PracticeLoopsPanel({
  timeline,
  loops,
  recordingId,
  onError,
  onRemoved,
}: {
  timeline: PracticeTimeline
  loops: PracticeLoops
  recordingId: string
  onError: (message: string | null) => void
  /** Delete goes disabled with the loop, so focus needs somewhere to go. */
  onRemoved: () => void
}) {
  const placed = loops.rows.map(placedLoop)
  // New loop depends on the playhead only through whether, and why not, it can make one there.
  const playheadMs = sourceMs(
    timeline,
    usePlayheadWhere(timeline.playhead, (ms) => {
      const result = newLoop(sourceMs(timeline, ms), placed, timeline.bounds)
      return result.kind === 'inside' ? `inside:${result.id}` : result.kind
    }),
  )
  return (
    <LoopsPanel
      recordingId={recordingId}
      loops={loops.rows}
      playback={loops.playback}
      playheadMs={playheadMs}
      bounds={timeline.bounds}
      renamingId={loops.renamingId}
      partStructure={loops.partStructure}
      canCreate={timeline.audioReady}
      onCommand={timeline.settledPlayheadMs}
      onCreated={() => {}}
      onError={onError}
      announce={timeline.announce}
      // The panel writes the chosen name; the field closes without saving its own text.
      onSuggestion={loops.endRename}
      onRemoved={onRemoved}
      onSetEdge={(edge) => loops.setEdge(edge, timeline.settledPlayheadMs())}
    />
  )
}

/** A drawn playhead (trimmed timeline) held to the take, on the source timeline. */
function sourceMs(timeline: PracticeTimeline, ms: number): number {
  return timeline.bounds.startMs + (timeline.loaded ? clamp(ms, 0, timeline.lengthMs) : 0)
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
