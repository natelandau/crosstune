import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useDestination } from './useDestination'
import type { Destination } from './destinations'

/**
 * A link to a destination. A plain click goes through `go`, so the destination reopens where
 * it last was and choosing the current one returns to its root; a modified click keeps the
 * browser's own behavior.
 */
export function DestinationLink({
  to,
  href,
  current,
  className,
  onChoose,
  describedBy,
  children,
}: {
  to: Destination
  href: string
  current: boolean
  className: string
  /** Runs, and settles, before navigating, such as clearing the catalog's status scope. */
  onChoose?: () => void | Promise<unknown>
  describedBy?: string
  children: ReactNode
}) {
  const { go } = useDestination()
  return (
    <Link
      to={href}
      aria-current={current ? 'page' : undefined}
      aria-describedby={describedBy}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        // A failed write is already surfaced by its owner; navigation still proceeds.
        void Promise.resolve(onChoose?.())
          .catch(() => {})
          .then(() => go(to))
      }}
    >
      {children}
    </Link>
  )
}
