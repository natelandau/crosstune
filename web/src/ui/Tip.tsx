import { useState, type ReactNode } from 'react'
import { Tooltip, TooltipTrigger } from 'react-aria-components'
import { useOverlayOpen } from './overlayClaim'

/** The pointer tooltip that names an icon-only control or a glyph. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <Tooltip className="t-caption bg-jet rounded-(--radius-row) px-2 py-1 text-white shadow-(--shadow-float)">
      {children}
    </Tooltip>
  )
}

/**
 * The one tooltip trigger. It holds the tooltip shut while any overlay is open: an open
 * tooltip takes Escape on the document before the overlay hears it.
 */
export function TipTrigger({
  isDisabled = false,
  children,
}: {
  isDisabled?: boolean
  /** The trigger, then its `Tip`. */
  children: ReactNode
}) {
  const overlayOpen = useOverlayOpen()
  const [open, setOpen] = useState(false)
  // A hover that began under an overlay must not show its tooltip once the overlay goes.
  if (overlayOpen && open) setOpen(false)
  return (
    <TooltipTrigger
      delay={500}
      isDisabled={isDisabled}
      isOpen={open && !overlayOpen}
      onOpenChange={setOpen}
    >
      {children}
    </TooltipTrigger>
  )
}
