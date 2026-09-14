import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { moveItem, removeFromList } from '../../commands/lists'
import { guardTrailingClick, useOpenRow, type SwipeRowState } from '../../components/swipe'
import type { Action } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import type { Instrument } from '../../db/types'
import { SongRow } from '../catalog/SongRow'
import { ReorderHandle, type Moves } from './ReorderHandle'
import type { ListItemView } from './useLists'

// A few pixels of travel before a drag starts, so a tap on the handle stays a click that opens its menu.
const HANDLE_ACTIVATION = { distance: 4 }

// Starting values; the zone reaches past the dock so a finger resting above it still scrolls.
const AUTO_SCROLL = { threshold: { x: 0, y: 0.2 }, acceleration: 10 }

// The live region below announces every move, dragged or chosen from the menu, exactly once.
const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
}
const INSTRUCTIONS: ScreenReaderInstructions = { draggable: '' }

/** The order a move shows until the live query returns the stored one, tied to the items it rearranged. */
interface PendingOrder {
  ids: string[]
  basis: ListItemView[]
}

export function ListSongs({
  listId,
  items,
  visible,
  instruments,
  runThen,
}: {
  listId: string
  /** Every item the list query returned; a new array means the stored order has caught up. */
  items: ListItemView[]
  visible: ListItemView[]
  instruments: ReadonlySet<Instrument>
  runThen: Action['runThen']
}) {
  const db = useDb()
  const navigate = useNavigate()
  const rowState = useOpenRow()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: HANDLE_ACTIVATION }))
  const [pending, setPending] = useState<PendingOrder | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [drag, setDrag] = useState<{ activeId: string; overId: string } | null>(null)
  const releaseClick = useRef<(() => void) | null>(null)

  const byId = new Map(visible.map((entry) => [entry.item.id, entry]))
  const ordered =
    pending?.basis === items ? pending.ids.flatMap((id) => byId.get(id) ?? []) : visible
  const ids = ordered.map((entry) => entry.item.id)
  // Rows only shift visually during a drag, so positions follow where the dragged row would land.
  const shown = drag ? arrayMove(ids, ids.indexOf(drag.activeId), ids.indexOf(drag.overId)) : ids

  const move = (entry: ListItemView, target: ListItemView) => {
    const from = ids.indexOf(entry.item.id)
    const to = ids.indexOf(target.item.id)
    if (from === to) return
    const next = arrayMove(ids, from, to)
    setPending({ ids: next, basis: items })
    runThen(
      async () => {
        try {
          await moveItem(db, listId, entry.item.id, target.item.id)
        } catch (error) {
          setPending(null)
          throw error
        }
      },
      () => setAnnouncement(`Moved ${entry.song.title} to position ${to + 1} of ${next.length}`),
    )
  }

  const endDrag = () => {
    setDrag(null)
    releaseClick.current?.()
    releaseClick.current = null
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        autoScroll={AUTO_SCROLL}
        accessibility={{ announcements: SILENT, screenReaderInstructions: INSTRUCTIONS }}
        onDragStart={({ active }) => {
          setDrag({ activeId: String(active.id), overId: String(active.id) })
          releaseClick.current = guardTrailingClick()
          rowState(String(active.id)).closeOpenRow()
        }}
        onDragOver={({ active, over }) => {
          if (over) setDrag({ activeId: String(active.id), overId: String(over.id) })
        }}
        onDragEnd={({ active, over }) => {
          endDrag()
          const entry = byId.get(String(active.id))
          const target = over ? byId.get(String(over.id)) : undefined
          if (entry && target) move(entry, target)
        }}
        onDragCancel={endDrag}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {ordered.map((entry, index) => (
              <SortableSong
                key={entry.item.id}
                entry={entry}
                position={shown.indexOf(entry.item.id) + 1}
                instruments={instruments}
                rowState={rowState(entry.item.id)}
                moves={{
                  toTop: index > 0 ? () => move(entry, ordered[0]!) : undefined,
                  up: index > 0 ? () => move(entry, ordered[index - 1]!) : undefined,
                  down:
                    index < ordered.length - 1 ? () => move(entry, ordered[index + 1]!) : undefined,
                  toBottom:
                    index < ordered.length - 1 ? () => move(entry, ordered.at(-1)!) : undefined,
                }}
                onEdit={() =>
                  void navigate({
                    to: '/songs/$id',
                    params: { id: entry.song.id },
                    search: { edit: true },
                    state: { editPushed: true },
                  })
                }
                onRemove={() =>
                  runThen(
                    () => removeFromList(db, entry.item.id),
                    () => {},
                  )
                }
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </>
  )
}

function SortableSong({
  entry,
  position,
  instruments,
  rowState,
  moves,
  onEdit,
  onRemove,
}: {
  entry: ListItemView
  position: number
  instruments: ReadonlySet<Instrument>
  rowState: SwipeRowState
  moves: Moves
  onEdit: () => void
  onRemove: () => void
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: entry.item.id })

  return (
    <li
      ref={setNodeRef}
      className={`rounded-box relative ${isDragging ? 'z-10 shadow-lg' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <SongRow
        entry={entry}
        instruments={instruments}
        {...rowState}
        leading={
          <span className="w-8 shrink-0 pl-3 text-sm tabular-nums opacity-60">{position}</span>
        }
        trailing={
          <span className="shrink-0 pr-1">
            <ReorderHandle
              title={entry.song.title}
              activatorRef={setActivatorNodeRef}
              listeners={listeners}
              moves={moves}
            />
          </span>
        }
        actions={[
          { label: 'Edit', tone: 'neutral', onPress: onEdit },
          { label: 'Remove', tone: 'error', onPress: onRemove },
        ]}
      />
    </li>
  )
}
