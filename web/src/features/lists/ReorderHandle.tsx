import type { DraggableSyntheticListeners } from '@dnd-kit/core'
import { useId, useRef, type CSSProperties, type ToggleEvent } from 'react'

export interface Moves {
  toTop?: () => void
  up?: () => void
  down?: () => void
  toBottom?: () => void
}

const MOVE_LABELS: [keyof Moves, string][] = [
  ['toTop', 'Move to top'],
  ['up', 'Move up'],
  ['down', 'Move down'],
  ['toBottom', 'Move to bottom'],
]

/**
 * A grip that drags its row, and on a tap or key press opens a menu of the same moves,
 * so reordering never depends on dragging. A move left undefined is shown disabled.
 */
export function ReorderHandle({
  title,
  activatorRef,
  listeners,
  moves,
}: {
  title: string
  activatorRef: (element: HTMLElement | null) => void
  listeners: DraggableSyntheticListeners
  moves: Moves
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Popover ids and anchor names must be valid identifiers, which useId's output is not.
  const key = `reorder-${useId().replace(/[^\w-]/g, '')}`

  return (
    <>
      <button
        ref={activatorRef}
        type="button"
        aria-label={`Reorder ${title}`}
        className="btn btn-ghost btn-square min-h-11 w-11 shrink-0 cursor-grab touch-none active:cursor-grabbing"
        popoverTarget={key}
        style={{ anchorName: `--${key}` } as CSSProperties}
        {...listeners}
        onPointerDown={(event) => {
          // The row around the handle swipes; a press here is only ever a reorder.
          event.stopPropagation()
          listeners?.onPointerDown?.(event)
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 12 18" className="h-4 w-3 fill-current opacity-60">
          {[3, 9].flatMap((cx) =>
            [3, 9, 15].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.5} />),
          )}
        </svg>
      </button>
      <div
        ref={menuRef}
        id={key}
        popover="auto"
        aria-label={`Move ${title}`}
        className="dropdown dropdown-end rounded-box bg-base-100 w-44 p-1 shadow-lg"
        style={{ positionAnchor: `--${key}` } as CSSProperties}
        onToggle={(event: ToggleEvent<HTMLDivElement>) => {
          if (event.newState === 'open') {
            menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
          }
        }}
      >
        {/* Display lives on this wrapper: a display class on the popover itself would override the rule that hides it while closed. */}
        <div className="flex flex-col">
          {MOVE_LABELS.map(([move, label]) => (
            <button
              key={move}
              type="button"
              className="btn btn-ghost min-h-11 justify-start font-normal"
              disabled={!moves[move]}
              onClick={() => {
                menuRef.current?.hidePopover?.()
                moves[move]?.()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
