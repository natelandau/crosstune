import { activeRecordingsForTune } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'

const live = (row: { deleted_at: string | null }) => !row.deleted_at

/**
 * Whether the musician has added anything to the tune beyond its title: a recording, link, or
 * scan, a place in a list, notes, or lyrics.
 */
export async function tuneHasWork(db: CrosstuneDb, tuneId: string): Promise<boolean> {
  const [tune, userTunes, recordings, links, scans] = await Promise.all([
    db.tunes.get(tuneId),
    db.user_tunes.where('tune_id').equals(tuneId).filter(live).toArray(),
    activeRecordingsForTune(db, tuneId),
    db.recording_links.where('tune_id').equals(tuneId).filter(live).count(),
    db.scans.where('tune_id').equals(tuneId).filter(live).count(),
  ])
  if (recordings.length > 0 || links > 0 || scans > 0) return true
  if (tune?.lyrics?.trim()) return true
  if (userTunes.some((userTune) => userTune.notes?.trim())) return true
  const listed = await db.list_items
    .where('user_tune_id')
    .anyOf(userTunes.map((userTune) => userTune.id))
    .filter(live)
    .count()
  return listed > 0
}
