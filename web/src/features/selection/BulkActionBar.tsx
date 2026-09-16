import { Ellipsis, ListPlus, SquarePen, Tag, type LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { PopoverMenu, type MenuItem } from '../../components/PopoverMenu'

export type MoreAction = MenuItem

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
      <PopoverMenu
        label="More actions"
        items={more}
        placement="top-end"
        // Overrides the dock's `> *` rule (bottom margin, full height, capped width, pointer
        // cursor, hover fade), which reaches this direct child of the dock once it opens.
        className="mb-0 h-auto max-w-none cursor-auto hover:opacity-100"
        trigger={(props) =>
          action('More', Ellipsis, { disabled: disabled || more.length === 0, ...props })
        }
      />
    </>
  )
}
