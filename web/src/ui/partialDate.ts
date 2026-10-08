/** A date known only in part, entered as a year, then a month, then a day. */

export const YEAR_FORMAT = 'Enter the year as four digits.'

export const YEAR_LABEL = 'Year'
export const MONTH_LABEL = 'Month'
export const DAY_LABEL = 'Day'
/** A month or day picker's empty choice: the date stops at the part before it. */
export const ANY_LABEL = 'Any'
export const CLEAR_DATE = 'Clear date'

/** Each month's number as the parts hold it, January first. */
export const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const MONTH_NAME = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' })
/** Each month's name in the reader's language, in the order of `MONTHS`. */
export const MONTH_LABELS = MONTHS.map((month) =>
  MONTH_NAME.format(Date.UTC(2000, Number(month) - 1)),
)

/** A date as a form holds it, a part at a time; an empty part is not given. */
export interface DateParts {
  year: string
  month: string
  day: string
}

export const NO_DATE: DateParts = { year: '', month: '', day: '' }

const FOUR_DIGITS = /^[1-9]\d{3}$/

export function isFullYear(year: string): boolean {
  return FOUR_DIGITS.test(year)
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
 * The parts with `patch` applied. A day only narrows a month, and one the new month or year
 * lacks is dropped rather than rolling over, reading as the field's empty choice, Not set or
 * Any.
 */
export function narrowedParts(current: DateParts, patch: Partial<DateParts>): DateParts {
  const next = { ...current, ...patch }
  if (!next.month) next.day = ''
  else if (Number(next.day) > dayCount(next)) next.day = ''
  return next
}
