import { describe, expect, it } from 'vitest'
import { STATUS_LABELS } from '../../constants'
import {
  addedToListToast,
  archivedToast,
  archiveLabel,
  createdListToast,
  deleteTunesLabel,
  editedToast,
  editTunesTitle,
  removedFromListToast,
  removeFromListLabel,
  selectedTitle,
  setStatusLabel,
} from './selectionCopy'

describe('selection copy', () => {
  it.each([
    [selectedTitle(3), '3 selected'],
    [editTunesTitle(1), 'Edit 1 tune'],
    [editTunesTitle(2), 'Edit 2 tunes'],
    [setStatusLabel(2, 'learning'), `Set 2 tunes to ${STATUS_LABELS.learning}`],
    [archiveLabel(1, true), 'Archive 1 tune'],
    [archiveLabel(2, false), 'Unarchive 2 tunes'],
    [removeFromListLabel(3), 'Remove 3 from list'],
    [deleteTunesLabel(2), 'Delete 2 tunes'],
    [archivedToast(2, true), 'Archived 2 tunes'],
    [archivedToast(1, false), 'Unarchived 1 tune'],
    [removedFromListToast(2, 'Thursday jam'), 'Removed 2 tunes from Thursday jam'],
    [editedToast(1), 'Edited 1 tune'],
    [createdListToast(3, 'Thursday jam'), 'Created Thursday jam with 3 tunes'],
    [addedToListToast(1, 'Thursday jam'), 'Added 1 tune to Thursday jam'],
  ])('reads %j', (built, expected) => {
    expect(built).toBe(expected)
  })
})
