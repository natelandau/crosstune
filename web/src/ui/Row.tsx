import { ArrowUpDown, type LucideIcon } from 'lucide-react'
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { Button as AriaButton, GridListItem, type Key } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { useLatest } from './useLatest'
import { Button, type ButtonVariant } from './Button'
import { MenuAtPoint } from './Menu'
import { ReorderContext } from './reorder'
import { RowSwipe } from './RowSwipe'

export interface RowAction {
  id: string
  label: string
  /**
   * Shown on a touch swipe action when `label` is too long for it; `label` stays its name. It
   * must be words from `label`, such as Archive for Archive tune, so a spoken command that
   * reads the visible text still matches the name (WCAG 2.5.3).
   */
  shortLabel?: string
  icon: LucideIcon
  tone?: 'neutral' | 'warning' | 'danger'
  onAction: () => void
}

// The event React Aria's focus scope sends from the element it is about to restore focus to; a
// list that hears it takes the focus for its row instead.
const FOCUS_RESTORE_EVENT = 'react-aria-focus-scope-restore'

const ACTION_VARIANT = {
  neutral: 'plain',
  warning: 'warning',
  danger: 'destructive',
} as const satisfies Record<NonNullable<RowAction['tone']>, ButtonVariant>

/**
 * A list row. Pointer actions lie over the trailing edge, transparent until hover or focus
 * within; opacity, unlike visibility, keeps them in the tab order and the accessibility tree. On touch they sit
 * behind the content and a left swipe reveals them. Right-click, Shift+F10, the ContextMenu
 * key, or a touch long press opens `menu ?? actions` at the pointer or the row.
 */
export function Row({
  id,
  textValue,
  leading,
  title,
  detail,
  trailing,
  actions = [],
  menu,
  dimmed = false,
  playing = false,
  fresh = false,
  stacked = false,
  titleEnd,
  titleTransition,
}: {
  id: Key
  textValue: string
  leading?: ReactNode
  title: string
  detail?: ReactNode
  trailing?: ReactNode
  actions?: RowAction[]
  menu?: RowAction[]
  dimmed?: boolean
  /** The row of the item the player has loaded, under a light wash. */
  playing?: boolean
  /** A row just added, such as a new take, which slides in under a brief slate highlight. */
  fresh?: boolean
  /** Two lines or more on every density, as a recording row is: the title, then `detail`. */
  stacked?: boolean
  /** Sits right after the title, such as a pin mark. */
  titleEnd?: ReactNode
  /** The view-transition name the title carries, so a page title can grow out of it. */
  titleTransition?: string
}) {
  const density = useStampedDensity()
  const reorder = useContext(ReorderContext)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const items = menu ?? actions
  // State, not a ref: the collection mounts the real row element after this component's first effect.
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const openAt = (x: number, y: number) => {
    if (items.length === 0) return
    // A touch hold leaves focus where it was, so the sheet would hand it back to the page on
    // close; focusing the row first makes the row what it returns to.
    if (density === 'touch') row?.focus()
    setAnchor({ x, y })
  }
  const openAtRef = useLatest(openAt)
  const hasMenuRef = useLatest(items.length > 0)

  // GridListItem does not forward key handlers to its row element.
  useEffect(() => {
    if (!row) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== row) return
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      // With no menu to show, the keys keep their browser meaning.
      if (!hasMenuRef.current) return
      event.preventDefault()
      const rect = row.getBoundingClientRect()
      openAtRef.current(rect.left + 16, rect.bottom)
    }
    // React Aria hands focus an overlay restores inside a list to the row, but a control in the
    // row that opened the overlay is where the musician left off.
    const onRestore = (event: Event) => {
      if (event.target !== row) event.stopPropagation()
    }
    row.addEventListener('keydown', onKeyDown)
    row.addEventListener(FOCUS_RESTORE_EVENT, onRestore)
    return () => {
      row.removeEventListener('keydown', onKeyDown)
      row.removeEventListener(FOCUS_RESTORE_EVENT, onRestore)
    }
  }, [row, openAtRef, hasMenuRef])
  const touch = density === 'touch'
  const titleText = (
    <span
      data-row-title
      className="t-body min-w-0 truncate"
      style={titleTransition ? { viewTransitionName: titleTransition } : undefined}
    >
      {title}
    </span>
  )
  const content = (
    <>
      {leading}
      {stacked ? (
        <div className="flex min-w-0 flex-1 flex-col py-1.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {titleText}
            {titleEnd}
          </span>
          {detail && <div className="t-secondary text-ink-2 min-w-0">{detail}</div>}
        </div>
      ) : (
        // On pointer the row is one line: the detail wraps to a second line, clipped away,
        // whenever it would not fit whole beside the title, so it never shows as a fragment.
        <div
          data-row-line
          className={
            touch
              ? 'flex min-w-0 flex-1 flex-col'
              : 't-body flex h-[1lh] min-w-0 flex-1 flex-wrap items-baseline gap-x-3 overflow-hidden'
          }
        >
          {titleText}
          {detail && (
            <span
              data-row-detail
              className={`t-secondary text-ink-2 min-w-0 ${touch ? 'truncate' : 'whitespace-nowrap'}`}
            >
              {detail}
            </span>
          )}
        </div>
      )}
      {touch && trailing}
      {reorder && (
        // The keyboard drag. Opacity, unlike visibility, keeps it in the tab order; React Aria
        // makes it ignore the pointer, so the whole row stays the mouse's drag handle.
        <AriaButton
          slot="drag"
          aria-label={reorder.moveLabel({ id, title })}
          className="bg-ground absolute inset-y-0 end-1 my-auto grid size-9 place-items-center rounded-full opacity-0 data-[focus-visible]:opacity-100"
        >
          <ArrowUpDown className="size-5" aria-hidden />
        </AriaButton>
      )}
    </>
  )
  return (
    <GridListItem
      id={id}
      textValue={textValue}
      onContextMenu={(event: React.MouseEvent) => {
        event.preventDefault()
        // A touch hold opens the menu on release from RowSwipe; the browser's own event would
        // open it mid-hold, before the hold can turn into a drag.
        const { pointerType } = event.nativeEvent as PointerEvent
        if (pointerType === 'touch' || (pointerType === 'pen' && touch)) return
        openAt(event.clientX, event.clientY)
      }}
      ref={setRow}
      data-playing={playing || undefined}
      data-new={fresh || undefined}
      className={`group relative flex min-h-(--target) cursor-default items-center rounded-(--radius-row) transition-shadow duration-(--dur-base) ease-(--ease) data-[lifted]:shadow-(--shadow-float) data-[reordering]:z-10 ${
        touch
          ? 'overflow-hidden'
          : `data-[selected]:bg-wash data-[reordering]:bg-ground! gap-3 px-3 py-0 data-[reordering]:bg-[linear-gradient(var(--row-tint),var(--row-tint))] data-[selected]:[--row-tint:var(--wash)] ${playing ? 'bg-(--play-wash) [--row-tint:var(--play-wash)]' : 'not-data-[selected]:hover:bg-row-hover [--row-tint:transparent] not-data-[selected]:hover:[--row-tint:var(--row-hover)]'}`
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      {touch ? (
        <RowSwipe rowKey={id} actions={actions} onLongPress={items.length > 0 ? openAt : undefined}>
          {content}
        </RowSwipe>
      ) : (
        <>
          {content}
          {/* The actions lie over the title's end, never over the trailing slot, which holds
              data such as the key. Resting, they take no width, so the title keeps it all. */}
          {(trailing || actions.length > 0) && (
            <div className="relative flex max-w-1/2 shrink-0 items-center self-stretch">
              {actions.length > 0 && (
                <div className="absolute inset-y-0 end-full flex items-center gap-1 bg-[linear-gradient(to_right,transparent,var(--row-tint)_1.5rem),linear-gradient(to_right,transparent,var(--ground)_1.5rem)] ps-8 pe-2 opacity-0 transition-opacity duration-(--dur-short) ease-(--ease) group-hover:opacity-100 focus-within:opacity-100">
                  {actions.map(({ id: actionId, label, icon, tone = 'neutral', onAction }) => (
                    <Button
                      key={actionId}
                      variant={ACTION_VARIANT[tone]}
                      icon={icon}
                      label={label}
                      iconOnly
                      onPress={onAction}
                    />
                  ))}
                </div>
              )}
              {trailing}
            </div>
          )}
        </>
      )}
      {items.length > 0 && (
        <div
          className="contents"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MenuAtPoint label={title} items={items} at={anchor} onClose={() => setAnchor(null)} />
        </div>
      )}
    </GridListItem>
  )
}
