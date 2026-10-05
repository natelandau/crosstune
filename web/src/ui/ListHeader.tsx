import type { ReactNode } from 'react'

/**
 * The line above a list that says how many rows it holds and, at its trailing edge, how they are
 * ordered. It scrolls with the list, so the order reads as a fact about these rows rather than a
 * screen-wide setting. `inset` lines it up with an inset list's row labels; without it, with a
 * full-width list's.
 */
export function ListHeader({
  count,
  sort,
  inset = false,
}: {
  count: string
  sort?: ReactNode
  inset?: boolean
}) {
  return (
    <div
      data-list-header
      className={`flex min-h-11 items-center gap-2 ${inset ? 'px-(--form-inset)' : 'px-(--form-gutter)'}`}
    >
      <p className="type-footnote m-0 min-w-0 flex-1 truncate tabular-nums">{count}</p>
      {sort}
    </div>
  )
}
