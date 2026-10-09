/** The tune's own Edit, which opens the tune form. */
export const EDIT_TUNE = 'Edit'
export const ADD_NOTES = 'Add notes'
/** The lyrics and notes controls once there is something to edit. */
export const EDIT_LYRICS = 'Edit lyrics'
export const EDIT_NOTES = 'Edit notes'
export const ADD_TO_LIST_TITLE = 'Add to a list'
export const OPEN_LYRICS = 'Open lyrics'

/** The headings of a tune page's sections, in the order the page shows them. */
export const RECORDINGS_SECTION = 'Recordings'
export const LYRICS_SECTION = 'Lyrics'
export const NOTES_SECTION = 'Notes'
export const LISTS_SECTION = 'Lists'

/**
 * The line that says how a tune was learned, as the words before the date and the date, so a
 * page can set the date in tabular figures.
 */
export function learnedLine(
  from: string | null,
  on: string | null,
): { words: string; date: string | null } {
  return { words: `Learned${from ? ` from ${from}` : ''}${on ? ' on ' : ''}`, date: on }
}

/** The empty states of a tune page's sections. */
export const NO_TUNE_RECORDINGS = 'No recordings yet'
export const NO_TUNE_RECORDINGS_HINT = 'Record one, paste a link, or find one on a music service.'
export const NO_TUNE_NOTES = 'No notes yet'
export const NO_TUNE_NOTES_HINT = 'Who you learned it from, bowings, or anything else to remember.'
