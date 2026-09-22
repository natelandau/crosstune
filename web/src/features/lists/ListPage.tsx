import { IonButton, useIonRouter } from '@ionic/react'
import { Ellipsis, ListMusic, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import { addToList, deleteList, removeFromList } from '../../commands/lists'
import { messageFor } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { DELETING, useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { InlineError } from '../../ui/InlineError'
import { MORE_ACTIONS, useMenu, type MenuItem } from '../../ui/Menu'
import { Screen } from '../../ui/Screen'
import { useRowArrowKeys } from '../../ui/useShortcut'
import { SHOW_ARCHIVED } from '../catalog/CatalogFilterSheet'
import { SelectionFooter } from '../selection/SelectionFooter'
import { useSelectionToolbar } from '../selection/SelectionToolbar'
import { useInstruments } from '../settings/useInstruments'
import { SongFormSheet, type SongFormTarget } from '../song/SongFormSheet'
import { DELETE_LIST_MESSAGE } from './deleteListMessage'
import { ListNameSheet, type ListNameTarget } from './ListNameSheet'
import { ListSongs, type ListSelectionState } from './ListSongs'
import { ADD_SONGS, SongPickerSheet } from './SongPickerSheet'
import { useListShowArchived } from './useListShowArchived'
import { useListView, type ListItemView } from './useLists'

export const EMPTY_LIST_HINT = 'Add songs to start this list.'
export const DELETE_LIST = 'Delete list'
export const ALL_ARCHIVED_TITLE = 'Every song here is archived'
export const HIDE_ARCHIVED = 'Hide archived'
export const EMPTY_LIST_TITLE = 'Nothing in this list'
export const LIST_GONE = 'This list is gone'
// Names the toggle, so the hint follows a rename of it.
const ARCHIVED_HINT = `Turn on ${SHOW_ARCHIVED} to see them.`

const noop = () => {}

// What the toolbar reads before any song has rendered, since its hook runs on every render
// while the rows that own the selection may not be on screen at all.
const NOTHING_SELECTABLE: ListSelectionState = {
  active: false,
  selection: {
    count: 0,
    allSelected: false,
    isSelected: () => false,
    toggle: noop,
    toggleRange: noop,
    selectAll: noop,
    clear: noop,
    toggleAll: noop,
  },
  actions: [],
  more: [],
  error: null,
  enter: noop,
  exit: noop,
  selectRef: noop,
}

/** One list: its songs in order, with the sheets that add, rename, and edit them. */
export function ListPage() {
  const { listId = '' } = useParams()
  const view = useListView(listId)
  const [showArchived, setShowArchived] = useListShowArchived()
  const instruments = useInstruments()
  const db = useDb()
  const router = useIonRouter()
  const openMenu = useMenu()
  const confirm = useConfirm()
  // The one error line: every action on this screen and every move report onto it, and
  // whichever spoke last is what shows.
  const [pageError, setPageError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [naming, setNaming] = useState<ListNameTarget | null>(null)
  const [form, setForm] = useState<SongFormTarget | null>(null)
  // The name of a list whose confirmed delete is running, so the live query reporting it gone
  // does not flash "This list is gone" while the screen navigates away.
  const [deletingName, setDeletingName] = useState<string | null>(null)
  // Published by the rows, which own the array the selection is made over.
  const [selection, setSelection] = useState<ListSelectionState | null>(null)
  // Refs rather than state: two presses in one tick both read the same committed state.
  const deleting = useRef(false)
  const removing = useRef(new Set<string>())
  const listRef = useRef<HTMLIonListElement>(null)
  useRowArrowKeys(listRef)

  const deleted = deletingName !== null
  const settingsRead = showArchived !== undefined && instruments !== undefined
  const ready = view !== undefined && settingsRead
  // One Screen in every state: swapping the IonPage element after the router outlet has
  // mounted it would leave the outlet holding a detached page.
  const list = view && !deleted ? view.list : null
  const notFound = ready && view === null && !deleted
  const visibleCount = view
    ? view.items.filter((item) => showArchived || item.userSong.archived_at === null).length
    : 0
  const items = view?.items
  const taken = useMemo(() => new Set(items ? items.map((item) => item.userSong.id) : []), [items])

  const chrome = selection ?? NOTHING_SELECTABLE
  const selecting = chrome.active
  const toolbar = useSelectionToolbar({
    selection: chrome.selection,
    actions: chrome.actions,
    more: chrome.more,
    onExit: chrome.exit,
  })

  const remove = async (item: ListItemView) => {
    const id = item.item.id
    if (removing.current.has(id)) return
    removing.current.add(id)
    setPageError(null)
    try {
      await removeFromList(db, id)
    } catch (caught) {
      setPageError(messageFor(caught))
    } finally {
      removing.current.delete(id)
    }
  }

  const removeList = async () => {
    if (!list || deleting.current) return
    deleting.current = true
    const ok = await confirm({
      title: `Delete "${list.name}"?`,
      message: DELETE_LIST_MESSAGE,
      action: 'Delete',
    })
    if (!ok) {
      deleting.current = false
      return
    }
    setPageError(null)
    setDeletingName(list.name)
    try {
      await deleteList(db, list.id)
    } catch (caught) {
      deleting.current = false
      setDeletingName(null)
      setPageError(messageFor(caught))
      return
    }
    if (router.canGoBack()) router.goBack()
    else router.push('/lists', 'back', 'replace')
  }

  const add = async (userSongId: string) => {
    if (!list) return
    setPageError(null)
    try {
      await addToList(db, list.id, userSongId)
    } catch (caught) {
      setPageError(messageFor(caught))
    }
  }

  const actions = (event: ReactMouseEvent) => {
    if (!list) return
    const menu: MenuItem[] = [
      ...(selection ? [{ label: 'Select', onPress: () => selection.enter() }] : []),
      {
        label: 'Rename',
        onPress: () => setNaming({ kind: 'rename', listId: list.id, name: list.name }),
      },
      showArchived
        ? { label: HIDE_ARCHIVED, onPress: () => void setShowArchived(false) }
        : { label: SHOW_ARCHIVED, onPress: () => void setShowArchived(true) },
      { label: DELETE_LIST, tone: 'error', onPress: () => void removeList() },
    ]
    openMenu(event, MORE_ACTIONS, menu)
  }

  return (
    <Screen
      title={
        selecting ? toolbar.title : list ? list.name : (deletingName ?? (notFound ? 'List' : ''))
      }
      titleClass={selecting ? toolbar.titleClass : undefined}
      level="pushed"
      backHref="/lists"
      selecting={selecting}
      start={selecting ? toolbar.start : undefined}
      end={
        selecting ? (
          toolbar.end
        ) : // The menu's wording states the archived setting, so it waits until the setting is read.
        list && settingsRead ? (
          <>
            <IonButton
              className="toolbar-control"
              aria-label={ADD_SONGS}
              onClick={() => setPicking(true)}
            >
              <Plus aria-hidden="true" className="size-7" />
            </IonButton>
            <IonButton
              ref={selection?.selectRef}
              className="toolbar-control"
              aria-label={MORE_ACTIONS}
              onClick={actions}
            >
              <Ellipsis aria-hidden="true" className="size-6" />
            </IonButton>
          </>
        ) : null
      }
      footer={
        selecting ? (
          <SelectionFooter
            selection={chrome.selection}
            actions={chrome.actions}
            more={chrome.more}
          />
        ) : null
      }
    >
      <h1 className="sr-only">{list?.name ?? deletingName ?? 'List'}</h1>
      {deleted ? (
        <p role="status" className="type-footnote px-5 pt-4">
          {DELETING}
        </p>
      ) : null}
      {notFound ? <EmptyState icon={ListMusic} title={LIST_GONE} /> : null}
      {view && list && showArchived !== undefined && instruments !== undefined ? (
        <>
          {pageError ? <InlineError className="px-5 py-2">{pageError}</InlineError> : null}
          {selection?.error ? (
            <InlineError className="px-5 py-2">{selection.error}</InlineError>
          ) : null}
          {view.items.length === 0 ? (
            <EmptyState
              icon={ListMusic}
              title={EMPTY_LIST_TITLE}
              hint={EMPTY_LIST_HINT}
              action={
                <IonButton shape="round" onClick={() => setPicking(true)}>
                  {ADD_SONGS}
                </IonButton>
              }
            />
          ) : visibleCount === 0 ? (
            <EmptyState
              icon={ListMusic}
              title={ALL_ARCHIVED_TITLE}
              hint={ARCHIVED_HINT}
              action={
                <IonButton shape="round" onClick={() => void setShowArchived(true)}>
                  {SHOW_ARCHIVED}
                </IonButton>
              }
            />
          ) : (
            <ListSongs
              ref={listRef}
              listId={list.id}
              items={view.items}
              showArchived={showArchived}
              instruments={instruments}
              selection={{
                listName: list.name,
                // A rename owns the screen, so nothing behind it, not even a long press, opens
                // a second mode over the same rows.
                enabled: naming === null,
                onChange: setSelection,
              }}
              onOpen={(songId) =>
                router.push(`/lists/${list.id}/songs/${songId}`, 'forward', 'push')
              }
              onEdit={(item) =>
                setForm({ kind: 'edit', entry: { song: item.song, userSong: item.userSong } })
              }
              onRemove={(item) => void remove(item)}
              onMoveStart={() => setPageError(null)}
              onError={setPageError}
            />
          )}
        </>
      ) : null}
      {list && instruments ? (
        <>
          <SongPickerSheet
            open={picking}
            listId={list.id}
            taken={taken}
            onClose={() => setPicking(false)}
            onCreate={(title) => setForm({ kind: 'new', title })}
          />
          <ListNameSheet
            target={naming}
            onClose={() => setNaming(null)}
            onSaved={() => setNaming(null)}
          />
          <SongFormSheet
            target={form}
            instruments={instruments}
            onClose={() => setForm(null)}
            onSaved={({ userSongId }) => {
              const created = form?.kind === 'new'
              setForm(null)
              if (created) void add(userSongId)
            }}
          />
        </>
      ) : null}
    </Screen>
  )
}
