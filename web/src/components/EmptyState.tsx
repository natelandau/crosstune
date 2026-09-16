import { HelpText } from './Page'
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action,
  compact = false,
}: {
  title: string
  hint?: string
  action?: ReactNode
  /** Less vertical room, for an empty list inside a section rather than one that is the screen. */
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? 'py-6' : 'py-16'}`}>
      <p className="text-title font-medium">{title}</p>
      {hint ? <HelpText>{hint}</HelpText> : null}
      {action}
    </div>
  )
}
