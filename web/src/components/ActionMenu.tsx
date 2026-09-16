import { EllipsisVertical } from 'lucide-react'
import { PopoverMenu, type MenuItem } from './PopoverMenu'

export type ActionItem = MenuItem

/** An overflow menu for page actions, anchored to its button at the end of the app bar. */
export function ActionMenu({ label, items }: { label: string; items: readonly ActionItem[] }) {
  return (
    <PopoverMenu
      label={label}
      items={items}
      placement="bottom-end"
      trigger={(props) => (
        <button
          type="button"
          className="btn btn-ghost btn-circle min-h-11 min-w-11"
          aria-label={label}
          {...props}
        >
          <EllipsisVertical aria-hidden="true" className="size-5" />
        </button>
      )}
    />
  )
}
