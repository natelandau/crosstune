// Dates are `YYYY-MM-DD` strings and calendar arithmetic runs on UTC midnights, so a day
// is always one day long whatever the musician's zone does around a clock change.

const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The local `YYYY-MM-DD` of an instant in an IANA zone. */
export function localDate(instant: string, timeZone: string): string {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatters.set(timeZone, format)
  }
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value
  return `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}`
}

function toUtc(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function daysSinceEpoch(date: string): number {
  return Math.round(toUtc(date) / DAY_MS)
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

/** 0 for Sunday through 6 for Saturday. */
export function weekday(date: string): number {
  return new Date(toUtc(date)).getUTCDay()
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** The `YYYY-MM` that is `count` months after `month`; negative counts go back. */
export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count
  const year = Math.floor(index / 12)
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** Every `YYYY-MM` from `first` through `last`, inclusive. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = []
  for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month)
  return months
}
