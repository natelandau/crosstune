import { tuneDeleteRecordings } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { countTunes } from '../../text/format'
import { deleteTuneMessage, deleteTunesMessage, deleteTuneTitle } from './deleteTuneMessage'
import type { CatalogEntry } from '../../db/types'

/**
 * The question that confirms deleting `entries`, counting the recordings it takes with them.
 * Read at press time rather than watched, because the count only has to be right for the
 * question being asked.
 */
export async function deleteTunesQuestion(
  db: CrosstuneDb,
  entries: readonly CatalogEntry[],
): Promise<{ title: string; message: string }> {
  const tuneIds = [...new Set(entries.map((entry) => entry.tune.id))]
  const { removed } = await tuneDeleteRecordings(db, tuneIds)
  const files = await db.recording_files.bulkGet(removed.map((row) => row.id))
  const views = files.map((file) => ({ file }))
  const only = entries.length === 1 ? entries[0] : undefined
  return only
    ? { title: deleteTuneTitle(only.tune.title), message: deleteTuneMessage(views) }
    : {
        title: `Delete ${countTunes(entries.length)}?`,
        message: deleteTunesMessage(views),
      }
}
