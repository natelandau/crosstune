export const NO_RECORDINGS_TITLE = 'No recordings yet'
export const NO_RECORDINGS_HINT = 'Use the record button to make one, or upload an audio file.'
export const SEARCH_RECORDINGS = 'Search recordings'
export const FILED_HEADER = 'Filed'
export const UNFILED_HEADER = 'Unfiled'
export const ALL_RECORDINGS = 'All'
export const MY_RECORDINGS = 'Mine'
export const SOURCE_SECTION = 'Source'
export const RECORDING_NAME_PLACEHOLDER = 'Jam at Tom’s, take 2, …'
export const EDIT_RECORDING_TITLE = 'Edit recording'
export const NAME_LABEL = 'Name'
export const DATE_RECORDED_LABEL = 'Date recorded'
export const ADD_TO_TUNE_TITLE = 'Add to a tune'
export const UPLOAD_AUDIO = 'Upload audio files'
export const STORAGE_USED = 'Storage used'
/** The toast once a recording is filed under a tune. */
export const filedToast = (title: string) => `Added to ${title}`
export const SAVE_RECORDING = 'Save'
/** The name of a tune search row that files the recording under that tune. */
export const addToTuneName = (title: string) => `Add to ${title}`
export const PLAYERS_LABEL = 'Players'
export const PLACE_LABEL = 'Place'
export const NOTES_LABEL = 'Notes'
export const RECORDING_NOTES_PLACEHOLDER = 'Tuning, who it came from, what to work on…'
export const CLEAR_PLACE = 'Clear place'
export const NO_PLACES_FOUND = 'No places found'
export const PLACE_SEARCH_UNAVAILABLE = 'Place search is unavailable right now.'
export const PLACE_SEARCH_OFFLINE = 'Place search needs a connection.'
/** A wait under a second still reads as one, since "0 seconds" invites an instant retry. */
export const placeSearchBusy = (seconds: number) => {
  const wait = Math.max(1, Math.ceil(seconds))
  return `Place search is busy. Try again in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`
}
