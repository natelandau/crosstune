import type { SongStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'

export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}
