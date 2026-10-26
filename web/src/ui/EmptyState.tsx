import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSubheadingLevel, type HeadingLevel } from './headingLevel'

/** Fills its container and centers an icon, a title, and an optional hint and action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  headingLevel,
  arriving = false,
}: {
  icon: LucideIcon
  title: string
  /** The title's heading level, one under the enclosing heading unless set. */
  headingLevel?: HeadingLevel
  hint?: string
  action?: ReactNode
  /** Fades in, since it took the place of content; see `useHadContent`. */
  arriving?: boolean
}) {
  const subheading = useSubheadingLevel()
  const Heading = `h${headingLevel ?? subheading}` as const
  return (
    <div
      className={`flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-8 text-center ${arriving ? 'arrive' : ''}`}
    >
      <Icon className="text-ink-2 size-10" aria-hidden />
      <Heading className="t-heading">{title}</Heading>
      {hint && <p className="t-secondary text-ink-2 max-w-sm">{hint}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}
