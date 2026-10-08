/** Recording labels the end-to-end suite needs, kept free of app imports so Node can load them. */

export const EDIT = 'Edit'
export const RECORDING_NAME_LABEL = 'Recording name'

/** The action that opens an imported recording on the site it came from. */
export const openOn = (label: string) => `Open on ${label}`

/** The exact time a take was recorded, shown while its date is being edited. */
export const recordedAtNote = (time: string) => `Recorded at ${time}`

export const ADD_TO_TUNE = 'Add to tune'
