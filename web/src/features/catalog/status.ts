import type { TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'

export function isSongStatus(value: string): value is TuneStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}
