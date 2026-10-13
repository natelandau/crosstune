import { localDaysBetween } from '../../text/localDate'

export const EDITED_TODAY = 'Edited today'
export const EDITED_YESTERDAY = 'Edited yesterday'

const THIS_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const OTHER_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Edited today", "Edited yesterday", or a short date, compared in local calendar days. */
export function editedLabel(iso: string, now: Date = new Date()): string {
  const edited = new Date(iso)
  const days = localDaysBetween(edited, now)
  if (days <= 0) return EDITED_TODAY
  if (days === 1) return EDITED_YESTERDAY
  const format = edited.getFullYear() === now.getFullYear() ? THIS_YEAR : OTHER_YEAR
  return `Edited ${format.format(edited)}`
}
