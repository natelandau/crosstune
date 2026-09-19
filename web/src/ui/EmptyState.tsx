import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
  /** Less vertical room, for an empty list inside a section rather than one that is the screen. */
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-8 text-center ${compact ? 'py-6' : 'py-16'}`}
    >
      <Icon
        aria-hidden="true"
        className={`text-(--ion-color-medium) ${compact ? 'size-8' : 'size-12'}`}
      />
      <p className="type-headline">{title}</p>
      {hint ? <p className="type-footnote">{hint}</p> : null}
      {action}
    </div>
  )
}
