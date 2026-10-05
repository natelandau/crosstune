import type { SortOptions } from '../../ui/SortMenu'
import { isDateSort, RECORDING_SORTS, type RecordingSort } from './arrangeRecordings'

export const SORT_LABELS: Record<RecordingSort, string> = {
  added: 'Date added',
  recorded: 'Date recorded',
  title: 'Title',
  tune: 'Tune',
}

export const RECORDING_SORT_OPTIONS: SortOptions<RecordingSort> = {
  sorts: RECORDING_SORTS,
  labels: SORT_LABELS,
  isDate: isDateSort,
}
