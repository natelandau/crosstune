import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Fills its container and centers an icon, a title, and an optional hint and action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  headingLevel = 2,
}: {
  icon: LucideIcon
  title: string
  /** The title's heading level, so it sits under the heading of whatever holds it. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  hint?: string
  action?: ReactNode
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <Icon className="text-ink-2 size-10" aria-hidden />
      <Heading className="t-heading">{title}</Heading>
      {hint && <p className="t-secondary text-ink-2 max-w-sm">{hint}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}
