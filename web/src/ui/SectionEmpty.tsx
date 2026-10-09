import type { LucideIcon } from 'lucide-react'

/**
 * An empty page section's placeholder: the empty-list icon, title, and hint, scaled to sit
 * under a section heading. The title is not a heading, since the section's own heading names it.
 */
export function SectionEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-6 text-center">
      <Icon className="text-ink-2 size-8" aria-hidden />
      <p className="t-body font-semibold">{title}</p>
      {hint && <p className="t-secondary text-ink-2 max-w-sm">{hint}</p>}
    </div>
  )
}
