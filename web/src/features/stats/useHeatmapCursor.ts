import { useState } from 'react'
import type { Day } from './types'
import { clamp } from '../../math'

// Weeks are columns, so a column away is a week away and a row away is a day.
const STEPS: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }

export interface HeatmapCursor {
  /** The chosen day's index in `days`, or null before any is chosen. */
  chosen: number | null
  choose(index: number): void
  /** Moves for a key name; true when the key moved the cursor, so its default is spent. */
  move(key: string): boolean
}

/** The heatmap's chosen day, moved by arrow keys, Home, and End, clamped to `days`. */
export function useHeatmapCursor(days: readonly Day[]): HeatmapCursor {
  const [chosen, setChosen] = useState<number | null>(null)
  const last = days.length - 1
  const move = (key: string) => {
    let next: number | null = null
    // The first arrow lands on today, the day a musician looks for first.
    if (key in STEPS) next = chosen === null ? last : chosen + STEPS[key]!
    else if (key === 'Home') next = 0
    else if (key === 'End') next = last
    if (next === null) return false
    setChosen(clamp(next, 0, last))
    return true
  }
  const choose = (index: number) => {
    if (index >= 0 && index <= last) setChosen(index)
  }
  return { chosen, choose, move }
}
