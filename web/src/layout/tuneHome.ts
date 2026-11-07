import { destination } from './destinations'

/** Where a bare `/tunes/:tuneId` link opens the tune: in the Catalog stack. */
export function tuneHomePath(tuneId: string | undefined): string {
  return `/catalog/${tuneId}`
}

/** A tune opened from a list, in the Lists stack, where Back returns to the list. */
export function listTunePath(listId: string, tuneId: string): string {
  return `/lists/${listId}/tunes/${tuneId}`
}

/** The title-only page a new tune starts on, in the Catalog stack. */
export const NEW_TUNE_PATH = '/catalog/new'

/**
 * A recording's page under `parent`, the tab's list or tune it opened from. Recordings' own
 * segment keeps the page's address apart from `/recordings/:tuneId`.
 */
export function recordingPath(parent: string, recordingId: string): string {
  const recordings = destination('recordings').root
  return parent === recordings
    ? `${recordings}/recording/${recordingId}`
    : `${parent}/recordings/${recordingId}`
}
