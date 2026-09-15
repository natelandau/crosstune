import type { ReactNode } from 'react'
import { SwipeRow, type SwipeAction } from '../../components/SwipeRow'
import type { SwipeRowState } from '../../components/swipe'
import { useLongPress } from '../../components/useLongPress'
import type { Instrument } from '../../db/types'
import { selectionCheckboxId } from '../selection/ids'
import { SongCard } from './SongCard'
import type { CatalogEntry } from './filters'

export interface RowSelection {
  active: boolean
  selected: boolean
  /** Position among the visible rows, which staggers the checkbox slide. */
  index: number
  onToggle: (shiftKey: boolean) => void
  onLongPress: () => void
}

// Rows past this share the last delay, so a long list does not take seconds to settle.
const STAGGER_ROWS = 8

/** A song as a swipeable two-row item, shared by every screen that lists songs. */
export function SongRow({
  entry,
  instruments,
  actions,
  leading,
  trailing,
  selection,
  ...rowState
}: SwipeRowState & {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  actions: readonly [SwipeAction, SwipeAction]
  leading?: ReactNode
  trailing?: ReactNode
  selection?: RowSelection
}) {
  const active = selection?.active ?? false
  const selected = active && (selection?.selected ?? false)
  const longPress = useLongPress(selection && !active ? selection.onLongPress : undefined)
  const title = entry.song.title

  return (
    <SwipeRow name={title} actions={actions} disabled={active} {...rowState}>
      <div
        {...longPress}
        className={`rounded-box flex items-center transition-[background-color,box-shadow] duration-(--select-tint-duration) ease-out select-none [-webkit-touch-callout:none] ${
          selected ? 'bg-primary/15 ring-primary ring-2 ring-inset' : ''
        } ${active ? 'cursor-pointer' : ''}`}
        onClick={selection && active ? (event) => selection.onToggle(event.shiftKey) : undefined}
      >
        {selection ? (
          <span
            aria-hidden={!active}
            inert={!active}
            className={`flex shrink-0 overflow-hidden duration-(--select-slot-duration) ease-(--ease-emphasized) motion-safe:transition-[width,margin,opacity,translate] motion-reduce:transition-opacity ${
              active ? 'ml-3 w-6 opacity-100' : 'ml-0 w-0 opacity-0 motion-safe:-translate-x-3.5'
            }`}
            style={{
              transitionDelay: active
                ? `calc(${Math.min(selection.index, STAGGER_ROWS - 1)} * var(--select-stagger))`
                : undefined,
            }}
          >
            <input
              id={selectionCheckboxId(entry.userSong.id)}
              type="checkbox"
              // daisyUI draws the mark with a clip-path wipe; it takes the selection tint timing, and
              // under reduced motion only its fade runs.
              className="checkbox checkbox-primary motion-safe:checked:animate-select-pop before:duration-(--select-tint-duration) motion-reduce:before:transition-opacity"
              aria-label={title}
              checked={selected}
              tabIndex={active ? undefined : -1}
              onChange={() => {}}
              onClick={(event) => {
                // The row's own click handler would toggle a second time.
                event.stopPropagation()
                selection.onToggle(event.shiftKey)
              }}
            />
          </span>
        ) : null}
        {leading}
        <div className="min-w-0 flex-1">
          <SongCard entry={entry} instruments={instruments} linked={!active} />
        </div>
        {trailing}
      </div>
    </SwipeRow>
  )
}
