import type { ReactNode, RefObject } from 'react'
import { Dialog, Popover, type PopoverProps } from 'react-aria-components'
import { OverlayClaim } from './overlayClaim'

/**
 * A named dialog in a popover at `triggerRef`, for a pointer control whose choice is not a
 * menu, such as a grid of pills. The trigger owns the open state, so a control with a remove
 * button beside it can still open one.
 */
export function PopoverDialog({
  label,
  triggerRef,
  isOpen,
  onOpenChange,
  placement = 'bottom start',
  className = '',
  children,
}: {
  label: string
  triggerRef: RefObject<HTMLElement | null>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  placement?: PopoverProps['placement']
  /** Classes for the surface, such as its width. */
  className?: string
  children: ReactNode
}) {
  return (
    <Popover
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement={placement}
      className={`bg-ground rounded-(--radius-surface) p-3 shadow-(--shadow-float) ${className}`}
    >
      <OverlayClaim close={() => onOpenChange(false)} />
      <Dialog aria-label={label} className="outline-none">
        {children}
      </Dialog>
    </Popover>
  )
}
