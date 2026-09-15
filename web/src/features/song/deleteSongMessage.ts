import { isNotUploaded } from '../../db/recordings'
import type { RecordingView } from '../recordings/useRecordings'

export function deleteSongMessage(title: string, recordings: RecordingView[]): string {
  const count = recordings.length
  if (count === 0) return `Delete "${title}"? This removes its links and list entries.`
  const noun = count === 1 ? 'recording' : 'recordings'
  const message = `Delete "${title}"? This removes its links, list entries, and ${count} ${noun}.`
  return recordings.some((view) => isNotUploaded(view.file))
    ? `${message} Some recordings have not uploaded, so they cannot be recovered.`
    : message
}
