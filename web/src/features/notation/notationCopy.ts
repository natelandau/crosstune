import { MAX_NOTATION_PAGES } from '../../commands/notation'
import {
  NOTATION_REFUSED_ERROR,
  NOTATION_STORAGE_FULL_ERROR,
  type NotationFile,
} from '../../db/notation'

/** The section on the tune screen, the row action that opens the viewer, and the viewer's name. */
export const NOTATION = 'Notation'
export const ADD_NOTATION = 'Add notation'
export const NO_NOTATION_TITLE = 'No notation yet'
export const NO_NOTATION_HINT = 'Add a photo or scan of the written tune.'
export const NOTATION_LIMIT_NOTE = `A tune holds up to ${MAX_NOTATION_PAGES} pages.`
export const INVERT = 'Invert'
export const ZOOM = 'Zoom'
export const DELETE_PAGE_TITLE = 'Delete this page?'
export const PAGE_UNREADABLE = 'This page cannot be shown'

/** Shown on a page whose upload the server refused for quota; the sync layer stores the code
 * `storage_full`. */
export const NOTATION_STORAGE_FULL = 'Not uploaded, storage full'
/** Shown on a page the server refused outright; the sync layer stores the code `refused`. */
export const NOTATION_REFUSED = 'Could not upload. Delete this page and add it again.'
/** Shown on a page captured here whose upload failed for a reason with no label of its own. */
export const NOTATION_NOT_UPLOADED = 'Not uploaded yet'
/** Shown on a page another device captured and has not uploaded yet. */
export const NOTATION_WAITING = 'Waiting for upload from another device'

export function pageName(index: number): string {
  return `Page ${index + 1}`
}

export function openPageName(index: number): string {
  return `Open page ${index + 1}`
}

export function deletePageName(index: number): string {
  return `Delete page ${index + 1}`
}

export function reorderPageName(index: number): string {
  return `Reorder page ${index + 1}`
}

export function downloadingPageName(index: number): string {
  return `Downloading page ${index + 1}`
}

export function pageCount(index: number, total: number): string {
  return `${index + 1} of ${total}`
}

/** The label for why a file has not uploaded, or null when it needs no word. Any other error on a
 * captured file, such as an image the server finds too large, still leaves it only on this
 * device, so the musician hears that much. */
export function pageErrorLabel(file: Pick<NotationFile, 'origin' | 'error'>): string | null {
  if (file.error === NOTATION_STORAGE_FULL_ERROR) return NOTATION_STORAGE_FULL
  if (file.error === NOTATION_REFUSED_ERROR) return NOTATION_REFUSED
  if (file.origin === 'captured' && file.error) return NOTATION_NOT_UPLOADED
  return null
}

/** Says how many picked files a tune had no room for. */
export function pagesNotAddedMessage(count: number): string {
  const pages = count === 1 ? '1 page was' : `${count} pages were`
  return `${pages} not added. ${NOTATION_LIMIT_NOTE}`
}

const AND = new Intl.ListFormat('en', { type: 'conjunction' })

/** Names every picked file the browser could not read, so the musician knows which to convert. */
export function unreadableFilesMessage(names: readonly string[]): string {
  const quoted = AND.format(names.map((name) => `"${name}"`))
  return names.length === 1
    ? `${quoted} is not an image this browser can read.`
    : `${quoted} are not images this browser can read.`
}
