import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef, useState } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { useDb } from '../../db/DbProvider'
import { getMeta, setMeta } from '../../db/meta'
import { useLatest } from '../../ui/useLatest'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { appliedFilters } from './appliedFilters'
import {
  DEFAULT_FILTERS,
  META_CATALOG_FILTERS,
  normalizeFilters,
  type CatalogFilters,
} from './filters'

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
  const analytics = useAnalytics()
  const currentRef = useLatest(filters ?? undefined)
  // The filters as the last patch left them, so a second patch before the next render diffs
  // against the first rather than reporting the same filter again. A render brings newer filters.
  const patchedRef = useRef<{ from: CatalogFilters | undefined; to: CatalogFilters } | null>(null)
  const update = useCallback(
    (patch: Partial<CatalogFilters>) => {
      const rendered = currentRef.current
      const patched = patchedRef.current
      const before =
        patched && patched.from === rendered ? patched.to : (rendered ?? DEFAULT_FILTERS)
      patchedRef.current = { from: rendered, to: { ...before, ...patch } }
      const applied = appliedFilters(before, patch)
      const next = writePending(patch)
      next.then(
        () => {
          setError(null)
          for (const filter of applied) analytics.send('catalog_filtered', { filter })
        },
        (caught: unknown) => {
          // The rolled-back filters can render as the same object the failed patch was built on.
          patchedRef.current = null
          console.warn('catalog: could not persist filters', caught)
          setError(FILTER_SAVE_ERROR)
        },
      )
      return next
    },
    [writePending, currentRef, analytics],
  )

  return [filters ?? undefined, update, error]
}
