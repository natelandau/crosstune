import { countTunes } from '../../text/format'

export const ADD_TO_LIST = 'Add to list'
/** A picker row's note, adding several tunes, for a list that already holds all of them. */
export const ALL_ALREADY_IN_LIST = 'All already in this list'
/** A picker row's note, adding several tunes, for a list that holds some of them. */
export const someAlreadyInList = (n: number, total: number) =>
  `${n} of ${total} already in this list`
export const addTunesToListTitle = (n: number) => `Add ${countTunes(n)} to a list`
