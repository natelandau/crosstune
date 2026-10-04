import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import { useDb } from '../../db/DbProvider'
import { getScanInvert, setScanInvert } from '../../db/meta'

/**
 * Whether this device shows scans as light ink on dark paper, undefined until read, and a way to
 * change it.
 */
export function useInvert(): [boolean | undefined, (on: boolean) => Promise<void>] {
  const db = useDb()
  const invert = useLiveQuery(() => getScanInvert(db), [db])
  const set = useCallback((on: boolean) => setScanInvert(db, on), [db])
  return [invert, set]
}
