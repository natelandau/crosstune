import { SquarePen, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DELETE, EDIT } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { RowAction } from '../../ui/rowTypes'
import { useAction } from '../../ui/useAction'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import type { ListNameTarget } from './useListName'
import { useListActions } from './useListActions'
import { useLists, type ListSummary } from './useLists'

export interface ListsScreen {
  /** Undefined until the first read. */
  lists: ListSummary[] | undefined
  /** The last failed delete. */
  error: string | null
  /** What the name sheet is for, null while it is closed. */
  naming: ListNameTarget | null
  setNaming: (target: ListNameTarget | null) => void
  /** Edit and Delete for one list's row. */
  rowActions: (list: ListSummary) => RowAction[]
  /** Asks, then deletes the list. */
  remove: (list: ListSummary) => Promise<void>
}

/** The lists screen's data and the actions its rows offer. */
export function useListsScreen({
  confirm,
}: {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
}): ListsScreen {
  const lists = useLists()
  const actions = useListActions()
  const { error, run } = useAction()
  const [naming, setNaming] = useState<ListNameTarget | null>(null)

  const remove = async (list: ListSummary) => {
    const ok = await confirm({
      title: `Delete "${list.name}"?`,
      message: DELETE_LIST_MESSAGE,
      action: DELETE,
    })
    if (ok) run(() => actions.remove(list.id))
  }

  const rowActions = (list: ListSummary): RowAction[] => [
    {
      label: EDIT,
      icon: SquarePen,
      tone: 'neutral',
      onPress: () => setNaming({ kind: 'rename', listId: list.id, name: list.name }),
    },
    {
      label: DELETE,
      icon: Trash2,
      tone: 'error',
      onPress: () => void remove(list),
    },
  ]

  return { lists, error, naming, setNaming, rowActions, remove }
}
