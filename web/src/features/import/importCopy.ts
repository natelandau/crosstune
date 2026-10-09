import { TUNE_LIMITS } from '../../api/vocabulary'
import { SITE_URL } from '../../auth/links'
import { countTunes } from '../selection/copy'
import { DETAIL_LABELS } from '../tune/detailFields'
import { STATUS_HEADER } from '../tune/tuneFormCopy'
import { IMPORT_LIMIT } from './review'

export const IMPORT_TUNES = 'Import tunes'

export const PASTE_LABEL = 'Your tunes'
export const PASTE_PLACEHOLDER = 'Paste your tunes, one per line'
export const OPEN_FILE = 'Open a file…'
export const CONTINUE = 'Continue'
export const TEXT_FILES_ONLY = 'Crosstune can open .txt files only.'

export const IMPORT_STATUS_LABEL = STATUS_HEADER
export const IMPORT_GENRE_LABEL = DETAIL_LABELS.genre
export const IMPORT_LIST_LABEL = 'Add these to a list'
export const NO_IMPORT_LIST = "Don't add"
export const NEW_IMPORT_LIST = 'New list'

export const ALREADY_IN_CATALOG = 'Already in your catalog'
export const SHORTENED_NOTE = `Shortened to ${TUNE_LIMITS.title} characters`
export const OVER_LIMIT_NOTE = `Only the first ${IMPORT_LIMIT} tunes are shown. Import the rest separately.`

export const WHAT_CAN_I_PASTE = 'What can I paste?'
export const RECORDINGS_NOTE =
  'This imports tune titles. To bring in recordings, upload them on the Recordings screen. You can choose many files at once.'
export const IMPORT_HELP_URL = `${SITE_URL}/help/import`

export function includeLabel(title: string): string {
  return `Include ${title}`
}

export function addTunesLabel(n: number): string {
  return `Add ${countTunes(n)}`
}

export function addedTunesToast(n: number): string {
  return `Added ${countTunes(n)}`
}

/** The default name of a list made by an import: "Imported" and the local date. */
export function importListName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Imported ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
