import type { RecordingPrecision } from '../../api/vocabulary'
import { RECORDED_DATE_FUTURE } from '../../commands/messages'
import { RECORDED_AT_LEEWAY_MS } from '../../commands/recordings'

export const YEAR_FORMAT = 'Enter the year as four digits.'

/** A recorded date as the Edit sheet holds it; an empty month or day is "Any". */
export interface DateParts {
  year: string
  month: string
  day: string
}

export interface StoredDate {
  recorded_at: string | null
  recorded_precision: RecordingPrecision | null
}

export const NO_DATE: DateParts = { year: '', month: '', day: '' }

const FOUR_DIGITS = /^[1-9]\d{3}$/

export function isFullYear(year: string): boolean {
  return FOUR_DIGITS.test(year)
}

/** A partial date is read in UTC, where it is stored; a take reads as the day it shows. */
export function partsOf(at: string | null, precision: RecordingPrecision | null): DateParts {
  if (!at || !precision) return NO_DATE
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return NO_DATE
  const local = precision === 'time'
  const year = local ? date.getFullYear() : date.getUTCFullYear()
  const month = (local ? date.getMonth() : date.getUTCMonth()) + 1
  const day = local ? date.getDate() : date.getUTCDate()
  return {
    year: String(year),
    month: precision === 'year' ? '' : String(month),
    day: precision === 'year' || precision === 'month' ? '' : String(day),
  }
}

/**
 * How many days the chosen month offers: none without a month, and 31 while the year is not
 * yet one, so a day already chosen keeps its option.
 */
export function dayCount({ year, month }: DateParts): number {
  if (!month) return 0
  if (!isFullYear(year)) return 31
  // Day 0 of the next month is the last of this one.
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
}

export function sameParts(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/**
 * The date to store at the most specific part given, or why the parts cannot be one. Without a
 * year there is no date, whatever month or day is left behind it.
 */
export function datePatch(parts: DateParts): StoredDate | { error: string } {
  if (!parts.year) return { recorded_at: null, recorded_precision: null }
  if (!isFullYear(parts.year)) return { error: YEAR_FORMAT }
  const year = Number(parts.year)
  if (year > new Date().getFullYear()) return { error: RECORDED_DATE_FUTURE }
  const start = new Date(0)
  // setUTCFullYear, unlike Date.UTC, never reads a year below 100 as 19xx.
  start.setUTCFullYear(year, parts.month ? Number(parts.month) - 1 : 0, Number(parts.day || 1))
  if (start.getTime() > Date.now() + RECORDED_AT_LEEWAY_MS) return { error: RECORDED_DATE_FUTURE }
  return {
    recorded_at: start.toISOString(),
    recorded_precision: parts.day ? 'day' : parts.month ? 'month' : 'year',
  }
}
