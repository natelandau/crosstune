import { isNotUploaded, type LocalFileState } from '../../db/recordings'

/** The confirmation's title for one tune, which names it as stored. */
export function deleteTuneTitle(title: string): string {
  return `Delete "${title}"?`
}

/** Only each recording's file state is read, so any recording view satisfies this. */
interface Recorded {
  file: { local_state: LocalFileState } | null | undefined
}

function message(possessive: string, recordings: readonly Recorded[]): string {
  const count = recordings.length
  const noun = count === 1 ? 'recording' : 'recordings'
  const removed =
    count === 0
      ? `${possessive} links and list entries`
      : `${possessive} links, list entries, and ${count} ${noun}`
  const text = `This removes ${removed}.`
  return recordings.some((view) => isNotUploaded(view.file))
    ? `${text} Some recordings have not uploaded, so they cannot be recovered.`
    : text
}

export function deleteTuneMessage(recordings: readonly Recorded[]): string {
  return message('its', recordings)
}

/** The bulk confirmation's message, which speaks of the whole selection. */
export function deleteTunesMessage(recordings: readonly Recorded[]): string {
  return message('their', recordings)
}
