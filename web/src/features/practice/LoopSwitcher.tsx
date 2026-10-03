import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { LocalRecordingLoop } from '../../db/types'
import { adjacent, loopName, placedLoop, type PlacedLoop, type Span } from './loopModel'
import { LOOP_SELECTED, NEXT_LOOP, NO_LOOP, PREVIOUS_LOOP } from './practiceCopy'
import type { LoopPlayback } from './useLoopPlayback'

const ARROW =
  'grid size-9 shrink-0 place-items-center rounded-full text-(--ion-color-primary) disabled:opacity-40'

/**
 * The selected loop's name between Previous and Next, under the play button. With no loop
 * selected the arrows reach the nearest loop each way from the playhead. With no loops it is
 * hidden but keeps its room, so a first loop never moves the controls around it.
 * Times are on the source timeline; `loops` is sorted by start.
 */
export function LoopSwitcher({
  loops,
  playback,
  playheadMs,
  trimStartMs,
  disabled = false,
  onCommand,
  onReveal,
  announce,
}: {
  loops: readonly LocalRecordingLoop[]
  playback: LoopPlayback
  playheadMs: number
  trimStartMs: number
  /** Turns both arrows off, such as while the audio is not loaded. */
  disabled?: boolean
  /** Runs ahead of a step, so it acts where the playhead shows. */
  onCommand: () => void
  /** Asks the screen to bring a stepped-to loop's start under the playhead. */
  onReveal: (span: Span) => void
  announce: (text: string) => void
}) {
  const empty = loops.length === 0
  const placed = loops.map(placedLoop)
  const nameById = (id: string) => {
    const row = loops.find((loop) => loop.id === id)
    return row ? loopName(row.label ?? null, row.start_ms, trimStartMs) : ''
  }
  const selected = playback.selectedId ? nameById(playback.selectedId) : ''
  const previous = adjacent('previous', playheadMs, placed, playback.selectedId)
  const next = adjacent('next', playheadMs, placed, playback.selectedId)

  const step = (target: PlacedLoop | null) => {
    if (!target) return
    onCommand()
    playback.select(target.id)
    onReveal({ startMs: target.startMs, endMs: target.endMs })
    announce(LOOP_SELECTED(nameById(target.id)))
  }

  return (
    <div
      data-loop-switcher
      inert={empty}
      aria-hidden={empty ? 'true' : undefined}
      className={`flex items-center justify-center gap-1 ${empty ? 'invisible' : ''}`}
    >
      <button
        type="button"
        aria-label={PREVIOUS_LOOP}
        disabled={disabled || !previous}
        className={ARROW}
        onClick={() => step(previous)}
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
      </button>
      <span className="type-footnote max-w-48 min-w-20 truncate text-center">
        {selected || NO_LOOP}
      </span>
      <button
        type="button"
        aria-label={NEXT_LOOP}
        disabled={disabled || !next}
        className={ARROW}
        onClick={() => step(next)}
      >
        <ChevronRight aria-hidden="true" className="size-5" />
      </button>
    </div>
  )
}
