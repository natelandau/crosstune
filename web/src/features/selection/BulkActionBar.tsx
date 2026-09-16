import { Ellipsis, ListPlus, SquarePen, Tag, type LucideIcon } from 'lucide-react'
import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ToggleEvent,
} from 'react'

export interface MoreAction {
  label: string
  tone: 'warning' | 'error'
  onSelect: () => void
}

/** The four action slots, in the same order on every screen that selects songs. */
export function BulkActionBar({
  disabled,
  onStatus,
  onEdit,
  onAddToList,
  more,
}: {
  disabled: boolean
  onStatus?: () => void
  onEdit?: () => void
  onAddToList?: () => void
  more: readonly MoreAction[]
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Popover ids and anchor names must be valid identifiers, which useId's output is not.
  const key = `bulk-more-${useId().replace(/[^\w-]/g, '')}`

  const action = (
    label: string,
    Icon: LucideIcon,
    props: ButtonHTMLAttributes<HTMLButtonElement>,
  ) => (
    <button type="button" className="min-h-11 disabled:opacity-40" {...props}>
      <Icon aria-hidden="true" className="size-6" />
      <span className="dock-label">{label}</span>
    </button>
  )

  return (
    <>
      {action('Status', Tag, { disabled: disabled || !onStatus, onClick: onStatus })}
      {action('Edit', SquarePen, { disabled: disabled || !onEdit, onClick: onEdit })}
      {action('Add to list', ListPlus, {
        disabled: disabled || !onAddToList,
        onClick: onAddToList,
      })}
      {action('More', Ellipsis, {
        disabled: disabled || more.length === 0,
        popoverTarget: key,
        style: { anchorName: `--${key}` } as CSSProperties,
      })}
      <div
        ref={menuRef}
        id={key}
        popover="auto"
        role="group"
        aria-label="More actions"
        // Overrides the dock's `> *` rule (centered flex column, max width, hover opacity), which
        // would otherwise apply once this direct child of the dock opens.
        className="dropdown dropdown-top dropdown-end rounded-box bg-base-100 text-base-content mb-0 h-auto w-56 max-w-none cursor-auto items-stretch p-1 shadow-lg hover:opacity-100"
        style={{ positionAnchor: `--${key}` } as CSSProperties}
        onToggle={(event: ToggleEvent<HTMLDivElement>) => {
          if (event.newState === 'open') menuRef.current?.querySelector('button')?.focus()
        }}
      >
        {/* Display lives on this wrapper: a display class on the popover itself would override the rule that hides it while closed. */}
        <div className="flex flex-col">
          {more.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`btn btn-ghost min-h-11 justify-start font-normal ${
                item.tone === 'error' ? 'text-error' : 'text-warning'
              }`}
              onClick={() => {
                menuRef.current?.hidePopover?.()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
