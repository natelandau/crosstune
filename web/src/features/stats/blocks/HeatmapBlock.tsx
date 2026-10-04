import { useState, type KeyboardEvent, type PointerEvent, type SyntheticEvent } from 'react'
import { Group } from '../../../ui/Group'
import { ACTIVITY_HEADER, ACTIVITY_HINT, dayDetail, weekMonthLabels } from '../copy'
import type { Heatmap } from '../types'

// An empty day is blank: a hairline ring keeps its slot without reading as a step.
const SHADES = [
  'shadow-[inset_0_0_0_1px_var(--fill-tertiary)]',
  'bg-(--heat-1)',
  'bg-(--heat-2)',
  'bg-(--heat-3)',
  'bg-(--heat-4)',
] as const

// Weeks are columns, so a column away is a week away and a row away is a day.
const STEPS: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }

/**
 * One cell per day, a column per week from Sunday. The cells are too small to be tap targets, so
 * the grid takes the tap, hover, or arrow keys itself and shows the chosen day's detail under
 * it; each active cell also carries its detail for assistive technology.
 */
export function HeatmapBlock({ heatmap, today }: { heatmap: Heatmap; today: string }) {
  const { days } = heatmap
  const [chosen, setChosen] = useState<number | null>(null)
  const day = chosen === null ? undefined : days[chosen]
  const choose = (event: SyntheticEvent) => {
    const date = (event.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date
    const index = date ? days.findIndex((candidate) => candidate.date === date) : -1
    if (index >= 0) setChosen(index)
  }
  const move = (event: KeyboardEvent) => {
    const last = days.length - 1
    // The first key press lands on today, the day a musician looks for first.
    const from = chosen ?? last
    let next: number | null = null
    if (event.key in STEPS) next = chosen === null ? last : from + STEPS[event.key]!
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    setChosen(Math.min(last, Math.max(0, next)))
  }
  const months = weekMonthLabels(days)
  return (
    <Group header={ACTIVITY_HEADER} plain>
      <div className="px-(--form-gutter)">
        <div
          aria-hidden="true"
          className="type-caption grid auto-cols-fr grid-flow-col gap-px pb-1 whitespace-nowrap"
        >
          {months.map((label, column) => (
            <span key={column} className="min-w-0 overflow-visible">
              {label}
            </span>
          ))}
        </div>
        <div
          role="group"
          aria-label={ACTIVITY_HEADER}
          tabIndex={0}
          className="grid auto-cols-fr grid-flow-col grid-rows-7 gap-px rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ion-color-primary)"
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
              className={`aspect-square rounded-[1px] ${SHADES[cell.level]} ${
                index === chosen ? 'outline outline-(--ion-text-color)' : ''
              }`}
            />
          ))}
        </div>
      </div>
      <p
        aria-live="polite"
        className="type-footnote px-(--form-inset) pt-(--form-text-gap) tabular-nums"
      >
        {day ? dayDetail(day, today) : ACTIVITY_HINT}
      </p>
    </Group>
  )
}
