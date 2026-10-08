import type { CSSProperties, ReactNode } from 'react'
import type { PlaybackEngine } from '../player/playbackEngine'
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
      {timeline.visible ? (
        <OverviewStrip
          shown={shown}
          lengthMs={timeline.lengthMs}
          trimStartMs={timeline.bounds.startMs}
          visible={timeline.visible}
          loops={loops.laneLoops}
          playheadMs={timeline.playheadMs}
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
              playheadMs={timeline.enginePlayheadMs}
              renamingId={loops.renamingId}
              onTap={loops.onTap}
              onRenameStart={loops.startRename}
              onRenameCommit={loops.commitRename}
              onRenameCancel={loops.endRename}
              onDraft={loops.onDraft}
              onCommit={loops.onCommit}
              pinches={pinches}
              scrubRef={timeline.scrub}
              onScrubbing={timeline.onScrubbing}
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
  return (
    <LoopSwitcher
      loops={loops.rows}
      playback={loops.playback}
      playheadMs={timeline.playheadMs}
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
  return (
    <LoopsPanel
      recordingId={recordingId}
      loops={loops.rows}
      playback={loops.playback}
      playheadMs={timeline.playheadMs}
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
    />
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
