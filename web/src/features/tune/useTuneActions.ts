import * as Sentry from '@sentry/react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import { deleteTune, setArchived } from '../../commands/tunes'
import { activeRecordingsForTune } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'

export interface TuneActions {
  /** Deletes the tune, reporting it with what it took along. */
  remove: (tuneId: string) => Promise<void>
  /** Archives or unarchives the tune, reporting the direction it went. */
  archive: (ids: { tuneId: string; userTuneId: string }, archived: boolean) => Promise<void>
}

const live = (row: { deleted_at: string | null }) => !row.deleted_at

/** What a delete takes along: the tune's live recordings, links, and scans. */
async function deletionCounts(db: CrosstuneDb, tuneId: string) {
  const [recordings, links, scans] = await Promise.all([
    activeRecordingsForTune(db, tuneId).then((rows) => rows.length),
    db.recording_links.where('tune_id').equals(tuneId).filter(live).count(),
    db.scans.where('tune_id').equals(tuneId).filter(live).count(),
  ])
  return { recordings, links, scans }
}

/** The writes a tune's menus share, with the reports they owe. */
export function useTuneActions(): TuneActions {
  const db = useDb()
  const analytics = useAnalytics()
  return {
    remove: async (tuneId) => {
      // Counted first, because the delete tombstones every one of them. A failed read costs
      // the report, never the delete.
      const counts = await deletionCounts(db, tuneId).catch((error: unknown) => {
        Sentry.captureException(error)
        return null
      })
      await deleteTune(db, tuneId)
      if (!counts) return
      analytics.send('tune_deleted', {
        recordings_count: countBucket(counts.recordings),
        links_count: countBucket(counts.links),
        scans_count: countBucket(counts.scans),
        tune_id: tuneId,
      })
    },
    archive: async ({ tuneId, userTuneId }, archived) => {
      await setArchived(db, userTuneId, archived)
      analytics.send(archived ? 'tune_archived' : 'tune_unarchived', { tune_id: tuneId })
    },
  }
}
