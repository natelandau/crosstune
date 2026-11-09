import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Heading,
  Popover,
} from 'react-aria-components'
import { useSubheadingLevel } from './headingLevel'
import { InBar } from './inBar'
import { OverlayClaim } from './overlayClaim'
import { POPOVER_SURFACE } from './popoverClasses'
import { PRESS } from './press'
import { TAP_AREA } from './tapArea'

/**
 * A button that names a tool and shows its current value, and opens the tool's controls in a
 * popover under it. A `changed` value, one that differs from its default, takes the accent. The
 * popover is a dialog named by its heading, the tool's name; Escape, an outside press, or the
 * button again closes it, and focus goes back to the button.
 */
export function ToolPopover({
  icon: Icon,
  label,
  value,
  changed = false,
  isOpen,
  onOpenChange,
  children,
  ...data
}: {
  icon: LucideIcon
  /** The tool's name, the popover's heading too. */
  label: string
  /**
   * The tool's current value, shown after its name and read as part of the button's name. Null
   * shows the name alone, such as for a tool that is off.
   */
  value: string | null
  changed?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** The tool's controls. */
  children: ReactNode
} & { [attribute: `data-${string}`]: string | boolean | undefined }) {
  const level = useSubheadingLevel()
  const accent = changed ? 'text-accent' : 'text-secondary'
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <AriaButton
        {...data}
        data-changed={changed || undefined}
        className={`t-body bg-surface not-aria-expanded:hover:bg-field aria-expanded:bg-tint aria-expanded:border-tint-strong text-primary inline-flex h-(--size-regular) shrink-0 items-center gap-2 rounded-(--radius) border border-transparent px-3.5 font-medium whitespace-nowrap transition-colors duration-(--dur-color) ease-(--ease) select-none in-data-[density=pointer]:h-(--size-large) ${TAP_AREA} ${PRESS}`}
      >
        <Icon aria-hidden className={`size-4.5 ${accent}`} />
        <span>{label}</span>
        {value !== null && (
          <>
            {' '}
            <span className={`t-num font-semibold ${accent}`}>{value}</span>
          </>
        )}
      </AriaButton>
      <Popover
        placement="bottom"
        offset={8}
        className={`${POPOVER_SURFACE} w-90 max-w-[calc(100vw-2rem)] p-3.5`}
      >
        <OverlayClaim />
        <Dialog className="flex flex-col gap-2.5 outline-none">
          <Heading slot="title" level={level} className="t-secondary text-secondary font-semibold">
            {label}
          </Heading>
          <InBar value={false}>{children}</InBar>
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
