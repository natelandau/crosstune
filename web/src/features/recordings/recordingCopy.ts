/** Recording labels the end-to-end suite needs, kept free of app imports so Node can load them. */

export const EDIT = 'Edit'
export const RECORDING_NAME_LABEL = 'Recording name'

/** The action that opens an imported recording on the site it came from. */
export const openOn = (label: string) => `Open on ${label}`

/** The exact time a recording was made, shown while its date is being edited. */
export const recordedAtNote = (time: string) => `Recorded at ${time}`

export const ADD_TO_TUNE = 'Add to tune'

/** The meta line of a recording the server refused for Premium, which waits on this device. */
export const LOCAL_UNTIL_SUBSCRIBED = 'On this device only. Syncs when you subscribe.'
/** Why a recording a free plan does not play is dimmed, heard after its row's name. */
export const SUBSCRIBE_TO_PLAY = 'Subscribe to play'
