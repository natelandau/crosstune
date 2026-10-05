import { createSortStore } from '../../ui/sortChoice'
import { DEFAULT_SORT, RECORDING_SORTS } from './arrangeRecordings'

export const RECORDINGS_SORT_KEY = 'crosstune.recordingsSort.v2'

export const { useSort: useRecordingsSort, setSort: setRecordingsSort } = createSortStore(
  RECORDINGS_SORT_KEY,
  RECORDING_SORTS,
  DEFAULT_SORT,
)
