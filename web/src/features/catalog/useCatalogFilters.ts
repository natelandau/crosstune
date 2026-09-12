import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef } from 'react'
import { useDb } from '../../db/DbProvider'
import { getMeta, setMeta } from '../../db/meta'
import {
  DEFAULT_FILTERS,
  META_CATALOG_FILTERS,
  normalizeFilters,
  type CatalogFilters,
} from './filters'

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

  // Mirrors the live query synchronously so back-to-back updates (e.g. fast typing)
  // merge onto each other's patch instead of a stale value from before the last write lands.
  const latestRef = useRef(filters)
  useEffect(() => {
    latestRef.current = filters
  }, [filters])

  // Chains writes so IndexedDB completions can't land out of call order and
  // clobber a later patch with an earlier one.
  const queueRef = useRef(Promise.resolve())
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      const next = queueRef.current.then(async () => {
        const merged = { ...(latestRef.current ?? DEFAULT_FILTERS), ...patch }
        latestRef.current = merged
        await setMeta(db, META_CATALOG_FILTERS, merged)
      })
      queueRef.current = next.catch((e: unknown) => {
        console.warn('catalog: could not persist filters', e)
      })
      return next
    },
    [db],
  )

  return [filters, update]
}
