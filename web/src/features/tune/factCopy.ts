export const ADD_VALUE = 'Add'
/** A fact row's accessible name: its label, then its value or the prompt to add one. */
export const factRowName = (label: string, text: string | null = null) =>
  `${label}, ${text ?? ADD_VALUE}`
export const MORE_DETAILS = 'More details'
export const DETAILS_GROUP = 'Details'
export const ABOUT_GROUP = 'About'
export const LEARNED_GROUP = 'Learned'
export const LISTS_GROUP = 'Lists'
export const ADDED_ON = (date: string) => `Added to catalog ${date}`
export const FACTS_LABEL = 'Tune details'
