import { Contrast, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { deleteScanName, INVERT, scanCount } from './scanCopy'
import type { ScanViewOrigin } from './scanViewLog'
import { useScanViewer } from './useScanViewer'
import { CLOSE, DELETE } from '../../ui/confirmCopy'
import { DURATION, EASE } from '../../theme/motion'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { useOverlayClaim } from '../../ui/overlayClaim'
import { ScanPages } from './ScanPages'

const MotionModalOverlay = motion.create(ModalOverlay)

interface Shown {
  tuneId: string
  startIndex: number
  origin: ScanViewOrigin
}

/**
 * A tune's scans over the whole window, one at a time, for reading at a jam. The screen stays
 * awake while it shows, and each look is logged under `origin`. Escape closes it and focus
 * returns to the control that opened it. It closes itself once the tune's last scan is gone.
 */
export function ScanViewer({
  tuneId,
  startIndex,
  origin,
  isOpen,
  onOpenChange,
  onClosed,
  now,
}: Shown & {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once the viewer has faded out and left the page. */
  onClosed?: () => void
  /** The clock views and taps are timed on. */
  now?: () => number
}) {
  // What it opened on, held through the fade out, since a caller may clear the tune as it
  // closes.
  const [shown, setShown] = useState<Shown>({ tuneId, startIndex, origin })
  if (
    isOpen &&
    (shown.tuneId !== tuneId ||
      shown.startIndex !== startIndex ||
      shown.origin.context !== origin.context ||
      shown.origin.listId !== origin.listId)
  ) {
    setShown({ tuneId, startIndex, origin })
  }
  return (
    <AnimatePresence onExitComplete={onClosed}>
      {isOpen && (
        <ViewerSurface
          key={shown.tuneId}
          {...shown}
          now={now}
          onClose={() => onOpenChange(false)}
        />
      )}
    </AnimatePresence>
  )
}

function ViewerSurface({
  tuneId,
  startIndex,
  origin,
  now = Date.now,
  onClose,
}: Shown & { now?: () => number; onClose: () => void }) {
  const confirm = useConfirm()
  const viewer = useScanViewer({ tuneId, startIndex, origin, now, confirm, onClose })
  useOverlayClaim({ coversShell: true, close: viewer.close })
  const { name, count, index, ready, invert, error } = viewer
  return (
    // A fade only, under reduced motion too: nothing moves, so there is nothing to reduce.
    <MotionModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) viewer.close()
      }}
      className="bg-ground fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.base, ease: EASE }}
    >
      <Modal className="h-full w-full">
        <Dialog
          aria-label={name}
          className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] outline-none"
        >
          <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <p className="t-heading t-num min-w-0 flex-1 px-2">
              {count > 0 ? scanCount(index, count) : ''}
            </p>
            <Button
              icon={Contrast}
              label={INVERT}
              iconOnly
              aria-pressed={invert}
              onPress={() => viewer.setInvert(!invert)}
            />
            <Button icon={X} label={CLOSE} iconOnly onPress={viewer.close} />
          </header>
          <ErrorLine error={error} place="bar" />
          {ready && (
            <ScanPages
              viewer={viewer}
              brokenAction={(at) => (
                <Button
                  variant="destructive"
                  label={DELETE}
                  name={deleteScanName(at)}
                  onPress={() => viewer.remove(at)}
                />
              )}
            />
          )}
        </Dialog>
      </Modal>
    </MotionModalOverlay>
  )
}
