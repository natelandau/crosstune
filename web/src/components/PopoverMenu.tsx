import {
  Fragment,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type ToggleEvent,
} from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  tone?: 'default' | 'warning' | 'danger'
  disabled?: boolean
}

const TONE_CLASSES: Record<NonNullable<MenuItem['tone']>, string> = {
  default: '',
  warning: 'text-warning',
  danger: 'text-error',
}

const PLACEMENT_CLASSES = {
  'bottom-end': 'dropdown dropdown-end',
  'top-end': 'dropdown dropdown-top dropdown-end',
}

const WALK_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/**
 * The one menu in the app. It is a native popover, so light dismiss, Escape, the top layer,
 * and returning focus to its button all come from the platform, and CSS anchor positioning
 * pins it to the button wherever that button sits.
 */
export function PopoverMenu({
  label,
  items,
  placement,
  className = '',
  trigger,
}: {
  /** Names the menu for assistive tech. */
  label: string
  items: readonly MenuItem[]
  /** 'bottom-end' below the trigger (app bar); 'top-end' above it (dock). */
  placement: 'bottom-end' | 'top-end'
  /** Appended to the menu, for a host whose own layout rules reach it. */
  className?: string
  /** Renders the trigger button; spread the given props onto it so the popover opens and anchors. */
  trigger: (props: {
    popoverTarget: string
    style: CSSProperties
    'aria-haspopup': 'menu'
    'aria-controls': string
  }) => ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Popover ids and anchor names must be valid identifiers, which useId's output is not.
  const key = `menu-${useId().replace(/[^\w-]/g, '')}`
  const firstDanger = items.findIndex((item) => item.tone === 'danger')

  const enabled = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    )

  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!WALK_KEYS.includes(event.key)) return
    const menuItems = enabled()
    if (menuItems.length === 0) return
    event.preventDefault()
    const current = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    // Focus outside the items starts the walk before the first one, so Down reaches the
    // first item and Up reaches the last.
    const from = current === -1 ? (event.key === 'ArrowDown' ? -1 : 0) : current
    const last = menuItems.length - 1
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowDown'
            ? (from + 1) % menuItems.length
            : (from + last) % menuItems.length
    menuItems[next]?.focus()
  }

  return (
    <>
      {trigger({
        popoverTarget: key,
        style: { anchorName: `--${key}` } as CSSProperties,
        'aria-haspopup': 'menu',
        'aria-controls': key,
      })}
      <div
        ref={menuRef}
        id={key}
        popover="auto"
        role="menu"
        aria-label={label}
        className={`${PLACEMENT_CLASSES[placement]} rounded-box bg-base-100 text-base-content border-base-content/10 w-56 border p-1 shadow-lg ${className}`}
        style={{ positionAnchor: `--${key}` } as CSSProperties}
        onToggle={(event: ToggleEvent<HTMLDivElement>) => {
          if (event.newState === 'open') enabled()[0]?.focus()
        }}
        onKeyDown={walk}
      >
        {/* Display lives on this wrapper: a display class on the popover itself would override the rule that hides it while closed. */}
        <div role="none" className="flex flex-col">
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {index === firstDanger && index > 0 ? (
                <div role="separator" className="border-base-content/10 my-1 border-t" />
              ) : null}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={`btn btn-ghost min-h-11 w-full justify-start gap-3 font-normal ${TONE_CLASSES[item.tone ?? 'default']}`}
                onClick={() => {
                  menuRef.current?.hidePopover?.()
                  item.onSelect()
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </>
  )
}
