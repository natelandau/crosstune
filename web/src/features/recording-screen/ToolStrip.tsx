import { Repeat, Scissors, type LucideIcon } from 'lucide-react'

export type ToolId = 'trim' | 'practice'

export interface Tool {
  id: ToolId
  label: string
  /** Shown only away from the tool's default, as "75%" beside Practice. */
  value?: string
  /** Why the tool cannot be used right now; the tool stays in reach and shows this. */
  disabled?: string
}

const ICONS: Record<ToolId, LucideIcon> = { trim: Scissors, practice: Repeat }

/**
 * The recording screen's tools in one row that scrolls sideways once more tools than fit are
 * added. Each tool opens a view of its own in place of the screen.
 */
export function ToolStrip({
  tools,
  onSelect,
}: {
  tools: readonly Tool[]
  onSelect: (id: ToolId) => void
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
      {tools.map((tool) => {
        const Icon = ICONS[tool.id]
        const detail = tool.disabled ?? tool.value
        return (
          <button
            key={tool.id}
            type="button"
            data-tool={tool.id}
            aria-disabled={tool.disabled ? true : undefined}
            className={[
              'flex min-h-14 min-w-20 shrink-0 flex-col items-center justify-center rounded-xl bg-(--fill-tertiary) px-3 py-1',
              tool.disabled ? 'opacity-50' : '',
            ].join(' ')}
            onClick={() => {
              if (!tool.disabled) onSelect(tool.id)
            }}
          >
            <span className="flex items-center gap-1.5">
              <Icon aria-hidden="true" className="size-4" />
              <span className="type-subheadline">{tool.label}</span>
            </span>{' '}
            {detail ? <span className="type-caption tabular-nums">{detail}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
