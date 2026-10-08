/** The tune's own Edit, which opens the tune form. */
export const EDIT_TUNE = 'Edit'
export const ADD_LYRICS = 'Add lyrics'
export const ADD_NOTES = 'Add notes'
/** The lyrics and notes controls once there is something to edit. */
export const EDIT_LYRICS = 'Edit lyrics'
export const EDIT_NOTES = 'Edit notes'
export const ADD_TO_LIST_TITLE = 'Add to a list'
export const OPEN_LYRICS = 'Open lyrics'

/** The headings of a tune page's sections, in the order the page shows them. */
export const RECORDINGS_SECTION = 'Recordings'
export const LYRICS_SECTION = 'Lyrics'
export const LISTS_SECTION = 'Lists'
export const NOTES_SECTION = 'Notes'

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
