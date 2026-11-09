import { useEffect, type ReactNode, type RefObject } from 'react'
import { Dialog, Popover, type PopoverProps } from 'react-aria-components'
import { OverlayClaim } from './overlayClaim'
import { InBar } from './inBar'
import { InOverlay } from './inOverlay'
import { POPOVER_SURFACE } from './popoverClasses'
import { useLatest } from './useLatest'

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
  onClosed,
  children,
}: {
  label: string
  triggerRef: RefObject<HTMLElement | null>
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  placement?: PopoverProps['placement']
  /** Classes for the surface, such as its width. */
  className?: string
  /** Runs once the popover has finished closing and left the page. */
  onClosed?: () => void
  children: ReactNode
}) {
  const isOpenRef = useLatest(isOpen)
  const onClosedRef = useLatest(onClosed)
  return (
    <Popover
      triggerRef={triggerRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement={placement}
      className={`${POPOVER_SURFACE} p-3 ${className}`}
    >
      <OverlayClaim close={() => onOpenChange(false)} />
      <ClosedSignal isOpenRef={isOpenRef} onClosedRef={onClosedRef} />
      <Dialog aria-label={label} className="outline-none">
        <InBar value={false}>
          <InOverlay value>{children}</InOverlay>
        </InBar>
      </Dialog>
    </Popover>
  )
}

/**
 * Mounted with the popover's content, which stays through its exit, so its unmount marks the
 * end of the close. The refs are the dialog's, since content can unmount without a last render.
 */
function ClosedSignal({
  isOpenRef,
  onClosedRef,
}: {
  isOpenRef: RefObject<boolean>
  onClosedRef: RefObject<(() => void) | undefined>
}) {
  // An unmount while still open is a remount or the page leaving, not a close.
  useEffect(
    () => () => {
      if (!isOpenRef.current) onClosedRef.current?.()
    },
    [isOpenRef, onClosedRef],
  )
  return null
}
