const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Edited today", "Edited yesterday", or a short date, compared in local calendar days. */
export function editedLabel(iso: string, now: Date = new Date()): string {
  const edited = new Date(iso)
  // Rounding absorbs the 23 or 25 hour days around a daylight saving change.
  const days = Math.round((startOfDay(now) - startOfDay(edited)) / DAY_MS)
  if (days <= 0) return 'Edited today'
  if (days === 1) return 'Edited yesterday'
  const format =
    edited.getFullYear() === now.getFullYear()
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
      : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `Edited ${format.format(edited)}`
}
