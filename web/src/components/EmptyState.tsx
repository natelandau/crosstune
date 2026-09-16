import { HelpText } from './Page'
import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-title font-medium">{title}</p>
      {hint ? <HelpText>{hint}</HelpText> : null}
      {action}
    </div>
  )
}
