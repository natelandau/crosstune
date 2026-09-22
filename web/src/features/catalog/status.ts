import { STATUS_LABELS } from '../../constants'
import type { SongStatus } from '../../api/vocabulary'

export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}
