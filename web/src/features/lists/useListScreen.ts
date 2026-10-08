import { useMemo, useRef, useState } from 'react'
import { addToList, deleteList, removeFromList } from '../../commands/lists'
import { useDb } from '../../db/DbProvider'
import type { LocalList } from '../../db/types'
import { DELETE } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { MenuItem } from '../../ui/menuTypes'
import { messageFor } from '../../ui/useAction'
import { useDeleteAndLeave } from '../../ui/useDeleteAndLeave'
import { SHOW_ARCHIVED } from '../catalog/catalogCopy'
import { useInstruments } from '../settings/useInstruments'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { SELECT } from '../selection/selectionCopy'
import { DELETE_LIST, HIDE_ARCHIVED, RENAME } from './listsCopy'
import type { ListNameTarget } from './useListName'
import { listShows, useListShowArchived } from './useListShowArchived'
import { useListView, type ListItemView } from './useLists'

export interface ListScreen {
  /** The list and the settings its screen needs have been read. */
  ready: boolean
  notFound: boolean
  /** Null until read, once deleted, and when the list is gone. */
  list: LocalList | null
  items: ListItemView[] | undefined
  /** The list's name while its confirmed delete runs, so "gone" is not mistaken for a remote delete. */
  deletingName: string | null
  /** The list and every setting its menu words have been read. */
  settingsRead: boolean
  visibleCount: number
  showArchived: boolean | undefined
  setShowArchived: (show: boolean) => Promise<void>
  instruments: ReturnType<typeof useInstruments>
  /** The one error line: every action on this screen and every move report onto it. */
  error: string | null
  setError: (message: string | null) => void
  /** The user tune ids already in the list. */
  taken: Set<string>
  /** Takes the item out of the list, resolving to what puts it back, or null when it failed. */
  remove: (item: ListItemView) => Promise<(() => Promise<void>) | null>
  add: (userTuneId: string) => Promise<void>
  removeList: () => void
  picking: boolean
  setPicking: (picking: boolean) => void
  naming: ListNameTarget | null
  setNaming: (target: ListNameTarget | null) => void
  /** The list's own actions; Select is offered only when `onSelect` is given. */
  menuItems: (options: { onSelect?: () => void }) => MenuItem[]
  /** Why there are no rows to show, null while there are some. */
  emptyKind: 'empty' | 'allArchived' | null
}

/** One list's data, its settings, and the actions its screen offers. */
export function useListScreen(
  listId: string,
  {
    confirm,
    leave,
  }: {
    confirm: (question: ConfirmQuestion) => Promise<boolean>
    leave: () => void
  },
): ListScreen {
  const view = useListView(listId)
  const [showArchived, setShowArchived] = useListShowArchived()
  const instruments = useInstruments()
  const db = useDb()
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState<ListNameTarget | null>(null)
  const { deletingName, start: startDelete } = useDeleteAndLeave({
    confirm,
    remove: () => deleteList(db, listId),
    leave,
    onStart: () => setError(null),
    onError: setError,
    subject: listId,
  })
  // A ref rather than state: two presses in one tick both read the same committed state.
  const removing = useRef(new Set<string>())

  const deleted = deletingName !== null
  const settingsRead = showArchived !== undefined && instruments !== undefined
  const ready = view !== undefined && settingsRead
  const list = view && !deleted ? view.list : null
  const notFound = ready && view === null && !deleted
  const items = view?.items
  const visibleCount = items ? items.filter((item) => listShows(item, !!showArchived)).length : 0
  const taken = useMemo(() => new Set(items ? items.map((item) => item.userTune.id) : []), [items])

  const remove = async (item: ListItemView) => {
    const id = item.item.id
    if (removing.current.has(id)) return null
    removing.current.add(id)
    setError(null)
    try {
      return await removeFromList(db, id)
    } catch (caught) {
      setError(messageFor(caught))
      return null
    } finally {
      removing.current.delete(id)
    }
  }

  const removeList = () => {
    if (!list) return
    void startDelete(list.name, {
      title: `Delete "${list.name}"?`,
      message: DELETE_LIST_MESSAGE,
      action: DELETE,
    })
  }

  const add = async (userTuneId: string) => {
    if (!list) return
    setError(null)
    try {
      await addToList(db, list.id, userTuneId)
    } catch (caught) {
      setError(messageFor(caught))
    }
  }

  const menuItems = ({ onSelect }: { onSelect?: () => void }): MenuItem[] => {
    if (!list) return []
    return [
      ...(onSelect ? [{ label: SELECT, onPress: onSelect }] : []),
      {
        label: RENAME,
        onPress: () => setNaming({ kind: 'rename', listId: list.id, name: list.name }),
      },
      showArchived
        ? { label: HIDE_ARCHIVED, onPress: () => void setShowArchived(false) }
        : { label: SHOW_ARCHIVED, onPress: () => void setShowArchived(true) },
      { label: DELETE_LIST, tone: 'error', onPress: removeList },
    ]
  }

  const emptyKind = !items
    ? null
    : items.length === 0
      ? 'empty'
      : visibleCount === 0
        ? 'allArchived'
        : null

  return {
    ready,
    notFound,
    list,
    items,
    deletingName,
    settingsRead,
    visibleCount,
    showArchived,
    setShowArchived,
    instruments,
    error,
    setError,
    taken,
    remove,
    add,
    removeList,
    picking,
    setPicking,
    naming,
    setNaming,
    menuItems,
    emptyKind,
  }
}
