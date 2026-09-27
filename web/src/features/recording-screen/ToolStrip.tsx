import { Gauge, Music, Scissors, type LucideIcon } from 'lucide-react'

export type ToolId = 'trim' | 'speed' | 'pitch'

export interface Tool {
  id: ToolId
  label: string
  /** Shown only away from the tool's default, as "75%" beside Speed. */
  value?: string
  /** Why the tool cannot be used right now; the tool stays in reach and shows this. */
  disabled?: string
  /** The id of the inline panel this tool opens, for a tool that opens one. */
  controls?: string
}

const ICONS: Record<ToolId, LucideIcon> = { trim: Scissors, speed: Gauge, pitch: Music }

/**
 * The recording screen's tools in one row that scrolls sideways once more tools than fit are
 * added. A tool that opens a panel says whether it is open.
 */
export function ToolStrip({
  tools,
  selected,
  onSelect,
}: {
  tools: readonly Tool[]
  selected: ToolId | null
  onSelect: (id: ToolId) => void
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
      {tools.map((tool) => {
        const Icon = ICONS[tool.id]
        const chosen = selected === tool.id
        const detail = tool.disabled ?? tool.value
        return (
          <button
            key={tool.id}
            type="button"
            data-tool={tool.id}
            aria-disabled={tool.disabled ? true : undefined}
            aria-expanded={tool.controls ? chosen : undefined}
            aria-controls={tool.controls && chosen ? tool.controls : undefined}
            className={[
              'flex min-h-14 min-w-20 shrink-0 flex-col items-center justify-center rounded-xl px-3 py-1',
              chosen
                ? 'bg-(--ion-color-primary) text-(--ion-color-primary-contrast)'
                : 'bg-(--fill-tertiary)',
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
