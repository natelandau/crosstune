import { NOT_SET } from '../../ui/fieldCopy'
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
export const LOCATION_LABEL = 'Location'
export const NOTES_LABEL = 'Notes'
export const RECORDING_NOTES_PLACEHOLDER = 'Tuning, who it came from, what to work on…'
export const CLEAR_LOCATION = 'Clear location'
export const NO_LOCATIONS_FOUND = 'No locations found'
export const LOCATION_SEARCH_UNAVAILABLE = 'Location search is unavailable right now.'
export const LOCATION_SEARCH_OFFLINE = 'Location search needs a connection.'
/** Under the location field and on the recording settings while the browser denies location. */
export const LOCATION_ACCESS_OFF =
  'Location access is off, so new takes don’t save where they were made. Allow location for this site in your browser’s settings.'
/** A wait under a second still reads as one, since "0 seconds" invites an instant retry. */
export const locationSearchBusy = (seconds: number) => {
  const wait = Math.max(1, Math.ceil(seconds))
  return `Location search is busy. Try again in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`
}

/** The location page's sections and actions. */
export const CURRENT_LOCATION = 'Current'
export const NEARBY_LOCATIONS = 'Nearby'
export const SAVED_LOCATIONS = 'Saved locations'
export const RECENT_LOCATIONS = 'Recent locations'
export const NAME_THIS_LOCATION = 'Name this location…'
export const OPEN_IN_MAPS = 'Open in Maps'
export const SEARCH_LOCATIONS = 'Search locations'
/** The practice header's location control, named for what it opens. */
export const editLocation = (name: string) => `Edit location, ${name}`
/** The edit sheet's Location row, which opens the location page. */
export const locationRowName = (name: string | null) => `${LOCATION_LABEL}, ${name ?? NOT_SET}`
/** Naming the take's spot as a saved location. */
export const NAME_LOCATION_TITLE = 'Name this location'
export const SAVED_HERE = 'Saved here'
export const LOCATION_NAME_LABEL = 'Location name'
export const NAME_LOCATION_HELP = 'Recordings made here show this name.'
/** Saves the typed name for the take's spot, once the edit is saved. */
export const SAVE_LOCATION_NAME = 'Save'
/** The name of a row that picks a location: the action label, then the row's lines. */
export const pickLocationName = (name: string, detail?: string | null) =>
  detail ? `Use ${name}, ${detail}` : `Use ${name}`
