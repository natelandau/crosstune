import {
  IonButton,
  IonList,
  IonRefresher,
  IonRefresherContent,
  useIonRouter,
  type RefresherCustomEvent,
} from '@ionic/react'
import { ListMusic, Plus, SquarePen, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { deleteList } from '../../commands/lists'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { usePointer } from '../../platform/pointer'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { InlineError } from '../../ui/InlineError'
import { Screen } from '../../ui/Screen'
import { useRowArrowKeys } from '../../ui/useShortcut'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { ListItem } from './ListItem'
import { ListNameSheet, type ListNameTarget } from './ListNameSheet'
import { useLists, type ListSummary } from './useLists'

export const NO_LISTS_HINT = 'A list is an ordered set of songs, like a setlist.'
export const ADD_LIST = 'Add list'
export const NO_LISTS_TITLE = 'No lists yet'

export function ListsPage() {
  const lists = useLists()
  const db = useDb()
  const engine = useSyncEngine()
  const router = useIonRouter()
  const pointer = usePointer()
  const confirm = useConfirm()
  const { error, run } = useAction()
  const [naming, setNaming] = useState<ListNameTarget | null>(null)
  const listRef = useRef<HTMLIonListElement>(null)
  useRowArrowKeys(listRef)

  const remove = async (list: ListSummary) => {
    const ok = await confirm({
      title: `Delete "${list.name}"?`,
      message: DELETE_LIST_MESSAGE,
      action: 'Delete',
    })
    if (ok) run(() => deleteList(db, list.id))
  }

  const refresh = (event: RefresherCustomEvent) => {
    void engine.sync().finally(() => event.detail.complete())
  }

  return (
    <Screen
      title="Lists"
      level="top"
      end={
        <IonButton aria-label={ADD_LIST} onClick={() => setNaming({ kind: 'new' })}>
          <Plus aria-hidden="true" className="size-7" />
        </IonButton>
      }
      refresher={
        pointer === 'touch' ? (
          <IonRefresher slot="fixed" onIonRefresh={refresh}>
            <IonRefresherContent />
          </IonRefresher>
        ) : null
      }
    >
      <h1 className="sr-only">Lists</h1>
      {lists ? (
        <>
          {error ? <InlineError className="px-5 py-2">{error}</InlineError> : null}
          {lists.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title={NO_LISTS_TITLE}
              hint={NO_LISTS_HINT}
              action={
                <IonButton shape="round" onClick={() => setNaming({ kind: 'new' })}>
                  {ADD_LIST}
                </IonButton>
              }
            />
          ) : (
            <IonList ref={listRef}>
              {lists.map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  onOpen={() => router.push(`/lists/${list.id}`, 'forward', 'push')}
                  actions={[
                    {
                      label: 'Edit',
                      icon: SquarePen,
                      tone: 'neutral',
                      onPress: () =>
                        setNaming({ kind: 'rename', listId: list.id, name: list.name }),
                    },
                    {
                      label: 'Delete',
                      icon: Trash2,
                      tone: 'error',
                      onPress: () => void remove(list),
                    },
                  ]}
                />
              ))}
            </IonList>
          )}
        </>
      ) : null}
      <ListNameSheet
        target={naming}
        onClose={() => setNaming(null)}
        onSaved={() => setNaming(null)}
      />
    </Screen>
  )
}
