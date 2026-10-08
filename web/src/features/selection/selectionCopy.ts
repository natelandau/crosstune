import type { TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { ARCHIVE, UNARCHIVE } from '../tune/archiveLabels'
import { countTunes } from './copy'

export const SELECT_ALL = 'Select all'
export const DESELECT_ALL = 'Deselect all'
export const SET_STATUS = 'Set status'
/** The row menu item that opens selection with that row selected. */
export const SELECT = 'Select'
export const EDIT_SELECTED = 'Edit'
/** A bulk edit row whose tunes disagree. */
export const MIXED = 'Mixed'
export const EDIT_ONLY_CHANGED = 'Only fields you change are saved.'
export const SAVE_EDIT = 'Save'
/** A yes or no field's choices in a bulk edit, which needs a third state a toggle lacks. */
export const YES = 'Yes'
export const NO = 'No'

export const selectedTitle = (n: number) => `${n} selected`
export const editTunesTitle = (n: number) => `Edit ${countTunes(n)}`

export const setStatusLabel = (n: number, status: TuneStatus) =>
  `Set ${countTunes(n)} to ${STATUS_LABELS[status]}`

/** The More-menu item that archives (or, when `archive` is false, restores) `n` tunes. */
export const archiveLabel = (n: number, archive: boolean) =>
  `${archive ? ARCHIVE : UNARCHIVE} ${countTunes(n)}`

export const removeFromListLabel = (n: number) => `Remove ${n} from list`
export const deleteTunesLabel = (n: number) => `Delete ${countTunes(n)}`

export const archivedToast = (n: number, archive: boolean) =>
  `${archive ? ARCHIVE : UNARCHIVE}d ${countTunes(n)}`
export const removedFromListToast = (n: number, listName: string) =>
  `Removed ${countTunes(n)} from ${listName}`
export const editedToast = (n: number) => `Edited ${countTunes(n)}`
export const createdListToast = (n: number, listName: string) =>
  `Created ${listName} with ${countTunes(n)}`
export const addedToListToast = (n: number, listName: string) =>
  `Added ${countTunes(n)} to ${listName}`

/** The name of the phone's bar of bulk actions. */
export const SELECTION_ACTIONS = 'Selection actions'
