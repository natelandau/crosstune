import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useMemo } from 'react'
import { useDb } from '../../db/DbProvider'
import { getMeta, META_RECORDINGS_ORIGIN, setMeta } from '../../db/meta'
import { usePendingWrite } from '../../ui/usePendingWrite'

/** 'all', 'own', or an import source's origin value. */
export type OriginChoice = 'all' | string

/** The origin the Recordings tab lists, kept per device; undefined until read. */
export function useRecordingsOrigin(): [OriginChoice | undefined, (next: OriginChoice) => void] {
  const db = useDb()
  const stored = useLiveQuery(
    // An unreadable choice reads as All, so a failing store never leaves the tab blank.
    () =>
      getMeta<OriginChoice>(db, META_RECORDINGS_ORIGIN, 'all').then(
        (origin) => origin || 'all',
        () => 'all',
      ),
    [db],
  )
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const row = useMemo(() => (stored === undefined ? undefined : { origin: stored }), [stored])
  const [shown, write] = usePendingWrite<{ origin: OriginChoice }>(row, ({ origin }) =>
    setMeta(db, META_RECORDINGS_ORIGIN, origin),
  )
  const choose = useCallback((next: OriginChoice) => void write({ origin: next }), [write])
  return [shown?.origin, choose]
}
