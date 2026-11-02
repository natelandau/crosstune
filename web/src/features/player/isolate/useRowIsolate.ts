import { useState } from 'react'
import type { LocalRecording } from '../../../db/types'
import { isMonoFromRow, isolateEquals, isolateFromRow, type IsolateSetting } from './isolateSetting'

export interface RowIsolate {
  setting: IsolateSetting
  isMono: boolean
}

/**
 * The row's isolate setting and mono flag, as one object that stays the same until either
 * changes, so an effect or a comparison can key on it.
 */
export function useRowIsolate(row: LocalRecording): RowIsolate {
  const read = { setting: isolateFromRow(row), isMono: isMonoFromRow(row) }
  const [kept, setKept] = useState(read)
  if (kept.isMono === read.isMono && isolateEquals(kept.setting, read.setting)) return kept
  setKept(read)
  return read
}
