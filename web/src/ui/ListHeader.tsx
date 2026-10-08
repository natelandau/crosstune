import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { MenuTriggerProps } from './Menu'

export interface ListSort {
  /** The current sort's name, shown beside the arrow. */
  label: string
  ascending: boolean
  /** The button's accessible name, with the direction in words. */
  spoken: string
  /** Wraps the sort button in the menu it opens, such as `(trigger) => <Menu trigger={trigger} ... />`. */
  menu: (trigger: ReactElement<MenuTriggerProps>) => ReactElement
}

/** The count of what a list shows, leading, and its sort control, trailing. */
export function ListHeader({ count, sort }: { count: string; sort?: ListSort }) {
  return (
    <div className="flex min-h-(--target) items-center justify-between gap-3 px-4">
      <p className="t-secondary t-num text-ink-2">{count}</p>
      {sort && <SortControl sort={sort} />}
    </div>
  )
}

function SortControl({ sort }: { sort: ListSort }) {
  const Arrow = sort.ascending ? ArrowUp : ArrowDown
  const button = (
    <AriaButton
      aria-label={sort.spoken}
      className="t-secondary text-slate inline-flex min-h-(--target-control) items-center gap-1 rounded-(--radius-capsule) px-2 data-[pressed]:opacity-60"
    >
      {sort.label}
      <Arrow className="size-4" aria-hidden />
    </AriaButton>
  )
  return sort.menu(button)
}
