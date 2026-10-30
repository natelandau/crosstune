import { useMemo, useRef, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../api/vocabulary'
import type { MenuItem } from '../../ui/menuTypes'
import { DELETE } from '../../ui/confirmCopy'
import { useAction } from '../../ui/useAction'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useDeleteAndLeave } from '../../ui/useDeleteAndLeave'
import { useLatest } from '../../ui/useLatest'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { useListActions } from '../lists/useListActions'
import { useActiveLists, useMembership } from '../lists/useLists'
import { lyricOpening } from '../lyrics/lyricLines'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import { useInstruments } from '../settings/useInstruments'
import { ARCHIVE, UNARCHIVE } from './archiveLabels'
import { deleteTunesQuestion } from './deleteTuneQuestion'
import { useTune, type TuneView } from './useTune'
import { EDIT_ALL_DETAILS } from './tuneScreenCopy'
import { useTuneActions } from './useTuneActions'

/** What a tune says about itself in its header, ready to draw. */
export interface TuneAttributes {
  title: string
  alternateTitles: string[]
  key: string | null
  modes: string[]
  archived: boolean
  /** True only for words: whitespace alone would open a reading view on a blank page. */
  hasLyrics: boolean
}

export interface TuneListMembership {
  id: string
  name: string
  /** The list item that removes the tune from this list. */
  itemId: string
}

export interface TuneScreenData {
  /** The live tune; undefined while it loads and once it is gone. */
  tune: TuneView | undefined
  /** True once the tune's row is gone, whether it never existed or was deleted on another
   * device. False while loading and while this screen's own confirmed delete runs. */
  missing: boolean
  /** True once the tune, the instruments, and the tune's recordings have all been read. */
  ready: boolean
  /** The instruments the user plays; undefined until the settings row is read. */
  instruments: ReadonlySet<Instrument> | undefined
  recordings: readonly RecordingView[] | undefined
  attributes: TuneAttributes | null
  notes: string | null
  inLists: TuneListMembership[]
  /** The tune's user row id as a one-item list, stable across renders for a list picker. */
  pickerTuneIds: string[]
  /** The one error line: a failed action or a failed delete, whichever spoke last. */
  error: string | null
  /** True while an action is in flight. */
  pending: boolean
  /** The title of a tune whose confirmed delete is running. */
  deletingName: string | null
  removeFromList: (itemId: string) => void
  /** Edit all details, Add to list, Archive or Unarchive, and Delete, in the order a menu
   * shows them. */
  menuFor: (handlers: { onAddToList: () => void; onEditAll: () => void }) => MenuItem[]
}

/**
 * Everything a tune page reads and does, as data and callbacks. `leave` runs once a confirmed
 * delete lands.
 */
export function useTuneScreen(
  tuneId: string,
  {
    confirm,
    leave,
  }: {
    confirm: (question: ConfirmQuestion) => Promise<boolean>
    leave: () => void
  },
): TuneScreenData {
  const db = useDb()
  const listActions = useListActions()
  const tuneActions = useTuneActions()
  const view = useTune(tuneId)
  const instruments = useInstruments()
  const recordings = useRecordingsWithFiles({ tuneId })
  const lists = useActiveLists()
  const userTuneId = view?.userTune.id
  const membership = useMembership(userTuneId ?? '')
  const action = useAction()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletion = useDeleteAndLeave({
    confirm,
    remove: () => tuneActions.remove(tuneId),
    leave,
    onStart: () => {
      setDeleteError(null)
      action.clear()
    },
    onError: setDeleteError,
    subject: tuneId,
  })
  useResetOnChange(tuneId, () => {
    setDeleteError(null)
    action.clear()
  })
  const deleted = deletion.deletingName !== null
  const pickerTuneIds = useMemo(() => (userTuneId ? [userTuneId] : []), [userTuneId])
  // A body runs to 20,000 characters, and a page re-renders on every change to the tune.
  const lyrics = view?.tune.lyrics
  const hasLyrics = useMemo(() => lyricOpening(lyrics, 1).length > 0, [lyrics])
  const ready = view !== undefined && instruments !== undefined && recordings !== undefined

  const tuneRef = useLatest(tuneId)
  const run = (work: () => Promise<unknown>) => {
    const mine = tuneId
    setDeleteError(null)
    // A refusal that lands after another tune opened belongs to the old one.
    action.run(async () => {
      try {
        await work()
      } catch (caught) {
        if (tuneRef.current === mine) throw caught
      }
    })
  }

  // A ref rather than state: two presses in one tick both read the same committed state.
  const removing = useRef(new Set<string>())
  const removeItem = (itemId: string) => {
    if (removing.current.has(itemId)) return
    const listId = [...membership].find(([, item]) => item === itemId)?.[0]
    // The item is no longer in any list, so another device already took it out.
    if (!listId) return
    removing.current.add(itemId)
    run(async () => {
      try {
        await listActions.removeItem(listId, itemId)
      } finally {
        removing.current.delete(itemId)
      }
    })
  }

  const menuFor: TuneScreenData['menuFor'] = ({ onAddToList, onEditAll }) => {
    if (!view) return []
    const archived = view.userTune.archived_at !== null
    return [
      { label: EDIT_ALL_DETAILS, onPress: onEditAll },
      { label: ADD_TO_LIST, onPress: onAddToList },
      {
        label: archived ? UNARCHIVE : ARCHIVE,
        tone: 'warning',
        onPress: () =>
          run(() => tuneActions.archive({ tuneId, userTuneId: view.userTune.id }, !archived)),
      },
      {
        label: DELETE,
        tone: 'error',
        onPress: () =>
          void deleteTunesQuestion(db, [view]).then((question) =>
            deletion.start(view.tune.title, { ...question, action: DELETE }),
          ),
      },
    ]
  }

  return {
    tune: view ?? undefined,
    missing: view === null && !deleted,
    ready,
    instruments,
    recordings,
    attributes: view
      ? {
          title: view.tune.title,
          alternateTitles: view.tune.alternate_titles,
          key: view.tune.key || null,
          modes: view.tune.modes,
          archived: view.userTune.archived_at !== null,
          hasLyrics,
        }
      : null,
    notes: view?.userTune.notes || null,
    inLists: (lists ?? []).flatMap((list) => {
      const itemId = membership.get(list.id)
      return itemId ? [{ id: list.id, name: list.name, itemId }] : []
    }),
    pickerTuneIds,
    error: deleteError ?? action.error,
    pending: action.pending,
    deletingName: deletion.deletingName,
    removeFromList: removeItem,
    menuFor,
  }
}
