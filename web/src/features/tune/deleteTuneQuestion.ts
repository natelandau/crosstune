import { activeRecordingsForTune } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { CatalogEntry } from '../catalog/filters'
import { countTunes } from '../selection/copy'
import { DELETE_TUNE_TITLE, deleteTuneMessage, deleteTunesMessage } from './deleteTuneMessage'

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
  const recordings = (
    await Promise.all(tuneIds.map((tuneId) => activeRecordingsForTune(db, tuneId)))
  ).flat()
  const files = await db.recording_files.bulkGet(recordings.map((row) => row.id))
  const views = files.map((file) => ({ file }))
  const only = entries.length === 1 ? entries[0] : undefined
  return only
    ? { title: DELETE_TUNE_TITLE, message: deleteTuneMessage(only.tune.title, views) }
    : {
        title: `Delete ${countTunes(entries.length)}?`,
        message: deleteTunesMessage(countTunes(entries.length), views),
      }
}
