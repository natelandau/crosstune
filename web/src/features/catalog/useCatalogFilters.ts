import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef } from 'react'
import { useDb } from '../../db/DbProvider'
import { getMeta, setMeta } from '../../db/meta'
import { META_CATALOG_FILTERS, normalizeFilters, type CatalogFilters } from './filters'

/** The persisted filters, undefined until they have been read. */
export function useCatalogFilters(): [
  CatalogFilters | undefined,
  (patch: Partial<CatalogFilters>) => Promise<void>,
] {
  const db = useDb()
  const filters = useLiveQuery(
    async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)),
    [db],
  )

  // Each patch merges onto the stored row inside its own transaction, and writes are
  // chained so back-to-back patches (fast typing, a click before the first read lands)
  // build on each other instead of on a snapshot from before the previous write.
  const queueRef = useRef(Promise.resolve())
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      const next = queueRef.current.then(() =>
        db.transaction('rw', db.meta, async () => {
          const stored = normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null))
          await setMeta(db, META_CATALOG_FILTERS, { ...stored, ...patch })
        }),
      )
      queueRef.current = next.catch((e: unknown) => {
        console.warn('catalog: could not persist filters', e)
      })
      return next
    },
    [db],
  )

  return [filters, update]
}
