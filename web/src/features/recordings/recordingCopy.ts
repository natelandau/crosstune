/** Recording labels the end-to-end suite needs, kept free of app imports so Node can load them. */

export const RENAME = 'Rename'
export const RECORDING_NAME_LABEL = 'Recording name'

/** The action that opens an imported recording on the site it came from. */
export const openOn = (label: string) => `Open on ${label}`
