import { isDateSort, type RecordingSort, type SortChoice } from './arrangeRecordings'

/** The name of the Recordings screen's sort menu. */
export const SORT = 'Sort'

export const SORT_LABELS: Record<RecordingSort, string> = {
  added: 'Date added',
  recorded: 'Date recorded',
  title: 'Title',
  tune: 'Tune',
}

export const NEWEST_FIRST = 'Newest first'
export const OLDEST_FIRST = 'Oldest first'
export const A_TO_Z = 'A to Z'
export const Z_TO_A = 'Z to A'

/** The words for the current sort's direction, read with its checked menu item. */
export function sortDirection({ sort, descending }: SortChoice): string {
  if (isDateSort(sort)) return descending ? NEWEST_FIRST : OLDEST_FIRST
  return descending ? Z_TO_A : A_TO_Z
}
