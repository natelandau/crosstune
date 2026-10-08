import { motion, useReducedMotionConfig } from 'motion/react'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Modal, ModalOverlay } from 'react-aria-components'
import { DURATION, EASE } from '../theme/motion'
import { growScale, originBox, scrim, SHEET } from './sheetGeometry'
import { useOverlayClaim } from './overlayClaim'

const MotionModalOverlay = motion.create(ModalOverlay)
const MotionModal = motion.create(Modal)

// Puts an upper surface's top edge a little way into the window's upper third.
const UPPER_TOP = '15vh'

/**
 * A centered surface over a scrim for a pointer frame: the overlay fades and the surface
 * scales up from just under full size, or out of `origin` when given. Reduced motion keeps the
 * fade and drops the scale.
 */
export function PointerOverlay({
  onOpenChange,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  backDismissable = !isKeyboardDismissDisabled,
  className,
  style,
  origin,
  placement = 'center',
  children,
}: {
  onOpenChange: (open: boolean) => void
  isDismissable?: boolean
  isKeyboardDismissDisabled?: boolean
  /** Whether a device back press closes it; by default, whenever Escape does. */
  backDismissable?: boolean
  /** Classes for the surface. */
  className: string
  style?: CSSProperties
  /** The control the surface grows out of and closes back into. */
  origin?: () => Element | null
  /** Centered in the window, or near the top of it, such as Quick Find's field. */
  placement?: 'center' | 'upper'
  children: ReactNode
}) {
  useOverlayClaim({
    coversShell: true,
    close: () => onOpenChange(false),
    dismissable: backDismissable,
  })
  const transition = { duration: DURATION.base, ease: EASE }
  const reduceMotion = useReducedMotionConfig() ?? false
  // Read once as it opens, so it closes back into the place it came from.
  const [box] = useState(() => (reduceMotion ? null : originBox(origin)))
  const from = reduceMotion ? 1 : box ? growScale(box, SHEET.width, 0.96) : 0.96
  const surface = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = surface.current
    if (!element || !box) return
    // Layout offsets, which the starting scale leaves alone, unlike the element's own box.
    // Placed again as the content grows, which recenters the surface, so it closes back into
    // the control from wherever it ends up.
    const place = () => {
      const x = box.left + box.width / 2 - element.offsetLeft
      const y = box.top + box.height / 2 - element.offsetTop
      element.style.transformOrigin = `${x}px ${y}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [box])
  return (
    <MotionModalOverlay
      isOpen
      onOpenChange={onOpenChange}
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      data-sheet-scrim
      className={`fixed inset-0 z-50 flex justify-center ${placement === 'upper' ? 'items-start' : 'items-center'}`}
      style={{
        backgroundColor: scrim(1),
        padding: SHEET.gutter,
        ...(placement === 'upper' && { paddingTop: UPPER_TOP }),
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={transition}
    >
      <MotionModal
        ref={surface}
        className={className}
        style={style}
        initial={{ scale: from, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: from, opacity: 0 }}
        transition={transition}
      >
        {children}
      </MotionModal>
    </MotionModalOverlay>
  )
}
