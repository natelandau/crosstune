import { STATUS_LABELS, type SongStatus } from '../../constants'

export function isSongStatus(value: string): value is SongStatus {
  return Object.hasOwn(STATUS_LABELS, value)
}
