const DAY_MS = 86_400_000

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Local calendar days from `from` to `to`: 0 on the same day, negative when `to` is earlier. */
export function localDaysBetween(from: Date, to: Date): number {
  // Rounding absorbs the 23 or 25 hour days around a daylight saving change.
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / DAY_MS)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The local `YYYY-MM-DD` of `date`. */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The local `HH:MM` of `date`, on a 24 hour clock. */
export function localIsoTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
