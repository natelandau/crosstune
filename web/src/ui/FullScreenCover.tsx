import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { DURATION, EASE } from '../theme/motion'
import { useOverlayClaim } from './overlayClaim'

const MotionModalOverlay = motion.create(ModalOverlay)

/**
 * A dialog over the whole window on the page background, for content read at a distance, such
 * as lyrics or scans. It fades in and out; render it as the child of an `AnimatePresence`, which
 * keeps it through the fade out. Escape and a device back press call `onClose`, and focus
 * returns to the control that opened it.
 */
export function FullScreenCover({
  label,
  onClose,
  children,
}: {
  /** The dialog's accessible name. */
  label: string
  onClose: () => void
  children: ReactNode
}) {
  useOverlayClaim({ coversShell: true, close: onClose })
  return (
    // A fade only, under reduced motion too: nothing moves, so there is nothing to reduce.
    <MotionModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="bg-page fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.base, ease: EASE }}
    >
      <Modal className="h-full w-full">
        <Dialog
          aria-label={label}
          className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] outline-none"
        >
          {children}
        </Dialog>
      </Modal>
    </MotionModalOverlay>
  )
}
