import { countTunes } from '../selection/copy'

export const ADD_TO_LIST = 'Add to list'
/** A picker row's note for a list that holds none of the tunes being added. */
export const NONE_IN_IT = 'none in it'
export const addTunesToListTitle = (n: number) => `Add ${countTunes(n)} to a list`
