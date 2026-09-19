import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { getMeta, setMeta } from '../../db/meta'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { META_CATALOG_FILTERS, normalizeFilters, type CatalogFilters } from './filters'

export const FILTER_SAVE_ERROR = 'The filters could not be saved.'

/**
 * The persisted filters, undefined until they have been read, with any change still being
 * written already applied, and the last write failure.
 */
export function useCatalogFilters(): [
  CatalogFilters | undefined,
  (patch: Partial<CatalogFilters>) => Promise<void>,
  string | null,
] {
  const db = useDb()
  const stored = useLiveQuery(
    async () => normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null)),
    [db],
  )
  const [error, setError] = useState<string | null>(null)
  // Each patch merges onto the stored row inside its own transaction, so it builds on the
  // previous write rather than on a snapshot read before it.
  const write = useCallback(
    (patch: Partial<CatalogFilters>) =>
      db.transaction('rw', db.meta, async () => {
        const row = normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null))
        await setMeta(db, META_CATALOG_FILTERS, { ...row, ...patch })
      }),
    [db],
  )
  const [filters, writePending] = usePendingWrite(stored, write)
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      const next = writePending(patch)
      next.then(
        () => setError(null),
        (caught: unknown) => {
          console.warn('catalog: could not persist filters', caught)
          setError(FILTER_SAVE_ERROR)
        },
      )
      return next
    },
    [writePending],
  )

  return [filters ?? undefined, update, error]
}
