import { getConfig } from '@testing-library/react'
import { BLOCKING_OVERLAYS } from '../ui/useShortcut'

interface Overlay extends HTMLElement {
  /** Set by Ionic's controllers, which put an overlay in the page only in order to present it. */
  hasController?: boolean
  dismiss: () => Promise<boolean>
}

// A toast does not block the page, but one left open would still leak into the next test.
const OVERLAYS = `${BLOCKING_OVERLAYS}, ion-toast`

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * Every overlay the page has not finished with: one that is open, and one a controller has put in
 * the page but not yet presented, whose present is already on its way. A controller drops its
 * overlay out of the page as the dismissal ends, so one still in the page is never a spent one.
 */
function unsettled(): Overlay[] {
  return Array.from(document.querySelectorAll<Overlay>(OVERLAYS)).filter(
    (overlay) => !overlay.classList.contains('overlay-hidden') || overlay.hasController === true,
  )
}

/**
 * Dismisses every Ionic overlay and waits until the page holds none. An overlay torn down
 * mid-dismissal is put back into the page afterwards, where the next test would find its content.
 * Presenting takes several frames, so one pass is not enough: an overlay raised by work the test
 * left in flight is dismissed on a later pass, once it arrives.
 */
export async function settleOverlays() {
  const deadline = performance.now() + getConfig().asyncUtilTimeout
  for (;;) {
    const open = unsettled()
    if (open.length === 0) return
    if (performance.now() > deadline) {
      const names = open.map((overlay) => `${overlay.tagName.toLowerCase()}#${overlay.id}`)
      throw new Error(`An Ionic overlay never closed: ${names.join(', ')}`)
    }
    await Promise.all(open.map((overlay) => overlay.dismiss().catch(() => false)))
    await nextFrame()
  }
}
