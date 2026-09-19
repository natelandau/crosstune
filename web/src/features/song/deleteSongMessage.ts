import { isNotUploaded, type LocalFileState } from '../../db/recordings'

/** Only each recording's file state is read, so any recording view satisfies this. */
interface Recorded {
  file: { local_state: LocalFileState } | null | undefined
}

function message(subject: string, possessive: string, recordings: readonly Recorded[]): string {
  const count = recordings.length
  const noun = count === 1 ? 'recording' : 'recordings'
  const removed =
    count === 0
      ? `${possessive} links and list entries`
      : `${possessive} links, list entries, and ${count} ${noun}`
  const text = `Delete ${subject}? This removes ${removed}.`
  return recordings.some((view) => isNotUploaded(view.file))
    ? `${text} Some recordings have not uploaded, so they cannot be recovered.`
    : text
}

export function deleteSongMessage(title: string, recordings: readonly Recorded[]): string {
  return message(`"${title}"`, 'its', recordings)
}

/** The bulk confirmation, whose subject counts the selection: "12 songs". */
export function deleteSongsMessage(subject: string, recordings: readonly Recorded[]): string {
  return message(subject, 'their', recordings)
}
