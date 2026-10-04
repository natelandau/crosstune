import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback } from 'react'
import { useDb } from '../../db/DbProvider'
import { getNotationInvert, setNotationInvert } from '../../db/meta'

/**
 * Whether this device shows pages as light ink on dark paper, undefined until read, and a way to
 * change it.
 */
export function useInvert(): [boolean | undefined, (on: boolean) => Promise<void>] {
  const db = useDb()
  const invert = useLiveQuery(() => getNotationInvert(db), [db])
  const set = useCallback((on: boolean) => setNotationInvert(db, on), [db])
  return [invert, set]
}
