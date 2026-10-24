/** A catalog or list row's Edit, which opens the tune's page to edit it in place. */
export const EDIT_TUNE = 'Edit'
/** The page's More entry that opens the full tune form. */
export const EDIT_ALL_DETAILS = 'Edit all details'
/** The name of a control that edits a tune's lyrics, in the reader and on the Lyrics section. */
export const EDIT_LYRICS = 'Edit lyrics'
export const ADD_TO_LIST_TITLE = 'Add to a list'
/** The Lyrics section's control that opens the lyrics reader. */
export const OPEN_LYRICS = 'Open lyrics'

/** The headings of a tune page's sections, in the order the page shows them. */
export const RECORDINGS_SECTION = 'Recordings'
export const LYRICS_SECTION = 'Lyrics'
export const SCANS_SECTION = 'Scans and images'
export const NOTES_SECTION = 'Notes'

export const WRITE_A_NOTE = 'Write a note…'
/** Under the notes while they are edited, since nothing else says the words are kept. */
export const NOTES_SAVE_HINT = 'Saves as you type'

/** The add line, which offers the sections a tune has not used. */
export const ADD_TO_TUNE = 'Add to this tune'
/** The add line's actions: each one's name, then the text it shows after its plus. */
export const ADD_SCAN = 'Add scan or image'
export const ADD_SCAN_TEXT = 'Scan or image'
export const ADD_LYRICS = 'Add lyrics'
export const ADD_LYRICS_TEXT = 'Lyrics'
/** In the add line while a tune's first scan is read and added. */
export const ADDING_SCAN = 'Adding scan…'

/** The title's control, named with the title it renames. */
export const EDIT_TITLE = 'Rename'
/** The key tile of a tune with no key. */
export const KEY_TILE_EMPTY = 'Add key'

/** A free plan's recordings on a tune page, folded into one line. */
export function recordingsLine(count: number): string {
  return count === 1 ? '1 recording, subscribe to play' : `${count} recordings, subscribe to play`
}

/** The toast after a tune is created from the catalog search, which offers Undo. */
export function addedMessage(title: string): string {
  return `Added ${title}`
}

/** The toast after an Undo that kept the tune, since something was added to it meanwhile. */
export function keptMessage(title: string): string {
  return `Kept ${title}, since something was added to it`
}
