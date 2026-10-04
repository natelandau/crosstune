import { MAX_SCANS } from '../../commands/scans'
import { SCAN_REFUSED_ERROR, SCAN_STORAGE_FULL_ERROR, type ScanFile } from '../../db/scans'

/** The section on the tune screen, the row action that opens the viewer, and the viewer's name. */
export const SCANS = 'Scans'
export const ADD_SCANS = 'Add scans'
export const NO_SCANS_TITLE = 'No scans yet'
export const NO_SCANS_HINT = 'Add a photo of written music, lyrics, or notes.'
export const SCAN_LIMIT_NOTE = `A tune holds up to ${MAX_SCANS} scans.`
export const INVERT = 'Invert'
export const ZOOM = 'Zoom'
export const DELETE_SCAN_TITLE = 'Delete this scan?'
export const SCAN_UNREADABLE = 'This scan cannot be shown'

/** Shown on a scan whose upload the server refused for quota; the sync layer stores the code
 * `storage_full`. */
export const SCAN_STORAGE_FULL = 'Not uploaded, storage full'
/** Shown on a scan the server refused outright; the sync layer stores the code `refused`. */
export const SCAN_REFUSED = 'Could not upload. Delete this scan and add it again.'
/** Shown on a scan captured here whose upload failed for a reason with no label of its own. */
export const SCAN_NOT_UPLOADED = 'Not uploaded yet'
/** Shown on a scan another device captured and has not uploaded yet. */
export const SCAN_WAITING = 'Waiting for upload from another device'

export function scanName(index: number): string {
  return `Scan ${index + 1}`
}

export function openScanName(index: number): string {
  return `Open scan ${index + 1}`
}

export function deleteScanName(index: number): string {
  return `Delete scan ${index + 1}`
}

/** The move menu's header for the scan at `index`. */
export function moveScanName(index: number): string {
  return `Move scan ${index + 1}`
}

export function reorderScanName(index: number): string {
  return `Reorder scan ${index + 1}`
}

export function downloadingScanName(index: number): string {
  return `Downloading scan ${index + 1}`
}

export function scanCount(index: number, total: number): string {
  return `${index + 1} of ${total}`
}

/** The label for why a file has not uploaded, or null when it needs no word. Any other error on a
 * captured file, such as an image the server finds too large, still leaves it only on this
 * device, so the musician hears that much. */
export function scanErrorLabel(file: Pick<ScanFile, 'origin' | 'error'>): string | null {
  if (file.error === SCAN_STORAGE_FULL_ERROR) return SCAN_STORAGE_FULL
  if (file.error === SCAN_REFUSED_ERROR) return SCAN_REFUSED
  if (file.origin === 'captured' && file.error) return SCAN_NOT_UPLOADED
  return null
}

/** Says how many picked files a tune had no room for. */
export function scansNotAddedMessage(count: number): string {
  const scans = count === 1 ? '1 scan was' : `${count} scans were`
  return `${scans} not added. ${SCAN_LIMIT_NOTE}`
}

const AND = new Intl.ListFormat('en', { type: 'conjunction' })

/** Names every picked file the browser could not read, so the musician knows which to convert. */
export function unreadableFilesMessage(names: readonly string[]): string {
  const quoted = AND.format(names.map((name) => `"${name}"`))
  return names.length === 1
    ? `${quoted} is not an image this browser can read.`
    : `${quoted} are not images this browser can read.`
}
