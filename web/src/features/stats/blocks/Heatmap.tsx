import type { KeyboardEvent, PointerEvent, SyntheticEvent } from 'react'
import { ACTIVITY_HEADER, ACTIVITY_HINT, dayDetail, weekMonthLabels } from '../copy'
import type { Heatmap as HeatmapData } from '../types'
import { useHeatmapCursor } from '../useHeatmapCursor'
import { PageSection } from '../../../ui/PageSection'

// An empty day is blank: a hairline ring keeps its slot without reading as a step.
const STEPS = [
  'shadow-[inset_0_0_0_1px_var(--hairline)]',
  'bg-(--heat-1)',
  'bg-(--heat-2)',
  'bg-(--heat-3)',
  'bg-(--heat-4)',
] as const

/**
 * One cell per day, a column per week from Sunday, in slate quartile steps. The cells are too
 * small to be targets, so the grid is one tab stop that takes the tap, hover, or arrow keys
 * itself and shows the chosen day's detail under it; each active cell also carries its detail
 * for assistive technology.
 */
export function Heatmap({ heatmap, today }: { heatmap: HeatmapData; today: string }) {
  const { days } = heatmap
  const cursor = useHeatmapCursor(days)
  const { chosen } = cursor
  const day = chosen === null ? undefined : days[chosen]
  const choose = (event: SyntheticEvent) => {
    const date = (event.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date
    if (date) cursor.choose(days.findIndex((candidate) => candidate.date === date))
  }
  const move = (event: KeyboardEvent) => {
    if (cursor.move(event.key)) event.preventDefault()
  }
  return (
    <PageSection title={ACTIVITY_HEADER}>
      <div
        aria-hidden
        className="t-caption text-ink-2 grid auto-cols-fr grid-flow-col gap-px pb-1 whitespace-nowrap"
      >
        {weekMonthLabels(days).map((label, column) => (
          <span key={column} className="min-w-0 overflow-visible">
            {label}
          </span>
        ))}
      </div>
      <div
        role="group"
        aria-label={ACTIVITY_HEADER}
        tabIndex={0}
        className="grid auto-cols-fr grid-flow-col grid-rows-7 gap-px rounded-sm"
        onClick={choose}
        onPointerMove={(event: PointerEvent) => {
          // A scroll moves the cells under a still pointer and the browser reports a move with
          // no distance; that is not the musician pointing at a day.
          if (event.movementX !== 0 || event.movementY !== 0) choose(event)
        }}
        onKeyDown={move}
      >
        {days.map((cell, index) => (
          <div
            key={cell.date}
            data-date={cell.date}
            role={cell.level > 0 ? 'img' : undefined}
            aria-label={cell.level > 0 ? dayDetail(cell, today) : undefined}
            aria-hidden={cell.level > 0 ? undefined : true}
            className={`aspect-square rounded-[1px] ${STEPS[cell.level]} ${
              index === chosen ? 'outline-ink outline-2' : ''
            }`}
          />
        ))}
      </div>
      <p aria-live="polite" className="t-secondary t-num text-ink-2 pt-2">
        {day ? dayDetail(day, today) : ACTIVITY_HINT}
      </p>
    </PageSection>
  )
}
