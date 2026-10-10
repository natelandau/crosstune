import { Ellipsis, ListChecks, ListMusic, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Key, Selection } from 'react-aria-components'
import { useNavigate, useParams } from 'react-router'
import type { Instrument } from '../../api/vocabulary'
import { listTunePath } from '../../app/tuneHome'
import { SHOW_ARCHIVED, TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'
import {
  ADD_TUNES,
  ALL_ARCHIVED_HINT,
  ALL_ARCHIVED_TITLE,
  EMPTY_LIST_HINT,
  EMPTY_LIST_TITLE,
  LIST_GONE,
} from './listsCopy'
import type { ListItemView } from './useLists'
import { useListScreen } from './useListScreen'
import { useListSelection } from './useListSelection'
import { useListTunes, type ListTunes as ListTunesState } from './useListTunes'
import { removedFromListToast } from '../selection/selectionCopy'
import type { SelectionMode } from '../selection/useSelectionMode'
import { DELETING } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { useLeaveTo } from '../../app/backTrail'
import { useScreenCommand } from '../../app/screenCommands'
import { destination } from '../../app/destinations'

import { useFrame } from '../../platform/frame'
import { useRowScanViewer } from '../scans/useRowScanViewer'
import { applySelection } from '../selection/applySelection'
import { BulkSheets, SelectionBar } from '../selection/SelectionBar'
import { useSelectionReturn, useSelectionShell } from '../selection/useScreenSelection'
import { ColumnTitle } from '../../app/ColumnTitle'
import { BackLink, PaneBar } from '../../app/PaneBar'
import { useTuneFormLauncher } from '../tune/formLauncher'
import { tunePick } from '../tune/tunePick'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorLine } from '../../ui/ErrorLine'
import { Menu, type MenuEntry } from '../../ui/Menu'
import { useReorderAnnouncer } from '../../ui/reorder'
import { RowList } from '../../ui/RowList'
import { menuEntries } from '../../ui/sharedActions'
import { useToast } from '../../ui/Toast'
import { ListNameSheet } from './ListNameSheet'
import { ListPlayRow } from './ListPlayRow'
import { ListTuneRow } from './ListTuneRow'
import { useListRowSources } from './useListRowSource'
import { TunePickerSheet } from './TunePickerSheet'
import { useHadContent } from '../../ui/useHadContent'

const LISTS = destination('lists')
const NO_ITEMS: readonly ListItemView[] = []

/**
 * One list in the content column: its name as the title, Add tunes and More over it, and its
 * tunes in order. A tune opens in the detail column on wide and pushes on phone and split.
 */
export function ListPage({ listId }: { listId: string }) {
  const { tuneId } = useParams()
  const wide = useFrame() === 'wide'
  const confirm = useConfirm()
  const toast = useToast()
  const form = useTuneFormLauncher()
  const leaveTo = useLeaveTo()
  const screen = useListScreen(listId, { confirm, leave: () => leaveTo(LISTS.root) })
  const { list, items, deletingName, showArchived, instruments, notFound, error, setError } = screen
  const { announce, region } = useReorderAnnouncer()
  const loaded = Boolean(list && items && showArchived !== undefined && instruments !== undefined)
  const hadTunes = useHadContent(loaded && screen.emptyKind === null)
  const hadNoTunes = useHadContent(loaded && screen.emptyKind !== null)
  // Read here rather than by the rows, since the selection made over them dresses this page's
  // bar.
  const tunes = useListTunes({
    listId,
    items: items ?? NO_ITEMS,
    showArchived: showArchived ?? false,
    onMoveStart: () => setError(null),
    onError: setError,
  })
  const selecting = useListSelection({
    listId,
    listName: list?.name ?? '',
    items: items ?? NO_ITEMS,
    visible: tunes.visible,
    confirm,
    toast: toast.show,
  })
  const { mode } = selecting
  useSelectionShell(mode)
  const { moreRef, rowsRef, fromMore, fromRow, restore } = useSelectionReturn(mode)

  // Off wide a tune page covers the list, so a list gone under it leaves once it shows again.
  const shown = wide || tuneId === undefined
  const goneRef = useLatest(() => {
    toast.show(LIST_GONE)
    leaveTo(LISTS.root)
  })
  useEffect(() => {
    if (notFound && shown) goneRef.current()
  }, [notFound, shown, goneRef])

  const title = list?.name ?? deletingName ?? (notFound ? LIST_GONE : '')

  const remove = async (view: ListItemView) => {
    const name = list?.name
    const undo = await screen.remove(view)
    if (!undo || name === undefined) return
    toast.show(removedFromListToast(1, name), () => {
      undo().catch((caught: unknown) => setError(messageFor(caught)))
    })
  }

  useScreenCommand(
    { id: 'selectTunes', label: SELECT_TUNES, run: fromMore },
    shown && !mode.active && Boolean(list) && screen.settingsRead,
  )

  const more: MenuEntry[] = [
    { id: 'select', label: SELECT_TUNES, icon: ListChecks, onAction: fromMore },
    ...menuEntries(screen.menuItems({})),
  ]

  return (
    <>
      {mode.active ? (
        <SelectionBar selection={mode} actions={selecting.bulk} restoreFocus={restore} />
      ) : (
        <PaneBar
          title={title}
          leading={<BackLink to={LISTS.root} label={LISTS.label} />}
          trailing={
            // The menu's words state the archived setting, so the verbs wait until it is read.
            list &&
            screen.settingsRead && (
              <>
                <Button
                  icon={Plus}
                  label={ADD_TUNES}
                  iconOnly
                  onPress={() => screen.setPicking(true)}
                />
                <Menu
                  label={MORE_ACTIONS}
                  trigger={<Button ref={moreRef} icon={Ellipsis} label={MORE_ACTIONS} iconOnly />}
                  items={more}
                />
              </>
            )
          }
        />
      )}
      <ColumnTitle title={title} />
      {list && !mode.active && tunes.visible.length > 0 && (
        <ListPlayRow listId={list.id} rows={tunes.visible} onError={setError} />
      )}
      {deletingName !== null && (
        <p role="status" className="t-secondary text-ink-2 px-4 pb-2">
          {DELETING}
        </p>
      )}
      <ErrorLine error={error} place="bar" />
      {notFound && <EmptyState icon={ListMusic} title={LIST_GONE} />}
      {list && items && showArchived !== undefined && instruments !== undefined && (
        <>
          {screen.emptyKind === 'empty' ? (
            <EmptyState
              arriving={hadTunes}
              icon={ListMusic}
              title={EMPTY_LIST_TITLE}
              hint={EMPTY_LIST_HINT}
              action={
                <Button
                  variant="primary"
                  label={ADD_TUNES}
                  onPress={() => screen.setPicking(true)}
                />
              }
            />
          ) : screen.emptyKind === 'allArchived' ? (
            <EmptyState
              arriving={hadTunes}
              icon={ListMusic}
              title={ALL_ARCHIVED_TITLE}
              hint={ALL_ARCHIVED_HINT}
              action={
                <Button
                  variant="primary"
                  label={SHOW_ARCHIVED}
                  onPress={() => void screen.setShowArchived(true)}
                />
              }
            />
          ) : (
            <div ref={rowsRef} className="contents">
              <ListTunes
                listId={list.id}
                tunes={tunes}
                mode={mode}
                instruments={instruments}
                tuneId={tuneId}
                wide={wide}
                onEdit={(view) => form.open({ source: 'list', tuneId: view.tune.id })}
                onRemove={(view) => void remove(view)}
                onSelect={(view) => fromRow(view.userTune.id)}
                announce={announce}
                arriving={hadNoTunes}
              />
            </div>
          )}
          <TunePickerSheet
            listId={list.id}
            taken={screen.taken}
            isOpen={screen.picking}
            onOpenChange={screen.setPicking}
          />
          <BulkSheets
            actions={selecting.bulk}
            entries={selecting.selected}
            context={selecting.context}
            instruments={instruments}
          />
        </>
      )}
      <ListNameSheet target={screen.naming} onClose={() => screen.setNaming(null)} />
      {region}
    </>
  )
}

/**
 * The list's rows, mounted once the list has read, so the rows can reorder from their first
 * render.
 */
function ListTunes({
  listId,
  tunes,
  mode,
  instruments,
  tuneId,
  wide,
  onEdit,
  onRemove,
  onSelect,
  announce,
  arriving,
}: {
  listId: string
  tunes: ListTunesState
  /** Selection over the rows, keyed by user tune. */
  mode: SelectionMode
  instruments: ReadonlySet<Instrument>
  /** The tune open beside or over the list. */
  tuneId: string | undefined
  wide: boolean
  onEdit: (view: ListItemView) => void
  onRemove: (view: ListItemView) => void
  onSelect: (view: ListItemView) => void
  announce: (text: string) => void
  /** Fades in, since the rows took the place of an empty state. */
  arriving: boolean
}) {
  const navigate = useNavigate()
  const { visible } = tunes
  const selecting = mode.active
  // The one row whose title morphs into the page title, as in the catalog: off wide only,
  // since on wide the list stays beside the page.
  const [opening, setOpening] = useState<string | null>(null)
  const scans = useRowScanViewer({ context: 'list', listId })
  const sources = useListRowSources(visible, tunes.playFirst)

  useEffect(() => {
    if (tunes.announcement) announce(tunes.announcement)
  }, [tunes.announcement, announce])

  const open = (view: ListItemView, replace = false) => {
    setOpening(view.item.id)
    void navigate(listTunePath(listId, view.tune.id), { replace, state: tunePick() })
  }
  const byKey = (key: Key) => visible.find((view) => view.item.id === String(key))

  // Between tunes the page replaces the one before, so walking the rows with the arrows does
  // not leave an entry in history for every tune passed.
  const choose = (keys: 'all' | Set<Key>) => {
    if (keys === 'all') return
    const [key] = keys
    const view = key === undefined ? undefined : byKey(key)
    if (!view || view.tune.id === tuneId) return
    open(view, tuneId !== undefined)
  }

  const selected = visible.find((view) => view.tune.id === tuneId)
  // Holds the widest number shown, so a list that runs into three digits does not step every
  // title after row 99 inward. Tabular figures make each digit one ch wide.
  const positionWidth = `max(1.5rem, ${String(visible.length).length}ch)`

  // The rows are keyed by list item and the selection by user tune.
  const choosing = (keys: Selection) =>
    applySelection(
      mode,
      keys === 'all' ? keys : new Set([...keys].flatMap((key) => byKey(key)?.userTune.id ?? [])),
    )

  return (
    <>
      <RowList
        label={TUNE_LIST}
        arriving={arriving}
        {...(selecting
          ? {
              selectionMode: 'multiple',
              selectionBehavior: 'toggle',
              selectedKeys: new Set(
                visible
                  .filter((view) => mode.selected.has(view.userTune.id))
                  .map((view) => view.item.id),
              ),
              onSelectionChange: choosing,
            }
          : {
              selectionMode: wide ? 'single' : 'none',
              // Selection follows focus only once a tune is open, so tabbing into the list never
              // opens one; Enter or a click opens the first.
              selectionBehavior: tuneId ? 'replace' : 'toggle',
              disallowEmptySelection: true,
              selectedKeys: new Set(selected ? [selected.item.id] : []),
              onSelectionChange: choose,
              onAction: wide
                ? undefined
                : (key: Key) => {
                    const view = byKey(key)
                    if (view) open(view)
                  },
            })}
        // Paused while selecting: a drag of one of several selected rows has no single place to go.
        onReorder={
          selecting
            ? undefined
            : (key, toIndex) => {
                const from = visible.findIndex((view) => view.item.id === String(key))
                if (from >= 0) tunes.move(from, toIndex)
              }
        }
      >
        {visible.map((view, index) => (
          <ListTuneRow
            key={view.item.id}
            view={view}
            position={index + 1}
            positionWidth={positionWidth}
            instruments={instruments}
            source={sources?.get(view.item.id)}
            moves={tunes.moveItems(view, index)}
            onEdit={() => onEdit(view)}
            onRemove={() => onRemove(view)}
            onSelect={() => onSelect(view)}
            onViewScans={
              tunes.scanTunes.has(view.tune.id) ? () => scans.open(view.tune.id) : undefined
            }
            selecting={selecting}
            opening={!wide && view.item.id === opening}
          />
        ))}
      </RowList>
      {scans.viewer}
    </>
  )
}
