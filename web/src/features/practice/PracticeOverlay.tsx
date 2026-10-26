import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, type ReactNode } from 'react'
import { PracticeOpenerContext } from '../player/practiceOpener'
import { loadPracticeModal } from './practiceModalLoader'
import { usePracticeOverlay, usePracticeOverlayShown } from './usePracticeOverlay'

const PracticeModal = lazy(async () => ({ default: (await loadPracticeModal()).PracticeModal }))

/**
 * Practice for the recording the player has loaded, opened from the now-playing bar or the
 * dock's Expand through `PracticeOpenerContext`, which it provides to `children`. It is an
 * overlay, never a route, so the address never changes while it shows. Mount it inside the
 * router, which Go to tune and the sheets from More use. Practice's own code loads on its first
 * open, or ahead of it through `loadPracticeModal`.
 */
export function PracticeOverlay({ children }: { children: ReactNode }) {
  const overlay = usePracticeOverlay()
  const { shown, dismissed } = usePracticeOverlayShown()
  return (
    <PracticeOpenerContext.Provider value={overlay.open}>
      {children}
      {/* Only practice waits for its code on a first open; the shell keeps showing. */}
      <Suspense fallback={null}>
        <AnimatePresence onExitComplete={dismissed}>
          {shown?.open && (
            <PracticeModal key={shown.opening} id={shown.id} onClose={overlay.close} />
          )}
        </AnimatePresence>
      </Suspense>
    </PracticeOpenerContext.Provider>
  )
}
