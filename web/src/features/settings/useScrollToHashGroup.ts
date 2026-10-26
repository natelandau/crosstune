import { useEffect, type RefObject } from 'react'
import { useLocation } from 'react-router'
import { PENDING_GROUP } from './PendingGroup'

const INPUT_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const

/** The group a hash names, or empty for no hash or one that does not decode. */
function groupId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1))
  } catch {
    return ''
  }
}

/**
 * Scrolls the group the address's hash names to the top of `container`, so a link to a settings
 * group shows it. Each group renders once its own settings are read, so a group above the
 * target can arrive after it; the target is held at the top through those arrivals until every
 * group has arrived or the musician acts, focus moving into the page included, so a screen
 * reader moving through it is never snapped back. The scroll jumps, as a browser does to an
 * anchor, so it has no motion to reduce.
 */
export function useScrollToHashGroup(container: RefObject<HTMLElement | null>): void {
  const { hash, key } = useLocation()
  // Keyed on the location too, so a second visit to the same address scrolls again.
  useEffect(() => {
    const root = container.current
    const id = groupId(hash)
    if (!root || !id) return
    const observer = new MutationObserver(() => land())
    // Focus that moves into the page is the musician's; a pane taking focus as it opens is not.
    const focusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) release()
    }
    const release = () => {
      observer.disconnect()
      for (const type of INPUT_EVENTS) window.removeEventListener(type, release, true)
      window.removeEventListener('focusin', focusIn, true)
    }
    const land = () => {
      const group = root.querySelector(`#${CSS.escape(id)}`)
      // Instant even where a scroller's CSS asks for smooth scrolling.
      group?.scrollIntoView({ block: 'start', behavior: 'instant' })
      // With nothing left to arrive, a named group that is absent never will be either.
      if (!root.querySelector(`[${PENDING_GROUP}]`)) release()
    }
    observer.observe(root, { childList: true, subtree: true })
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, release, { capture: true, passive: true })
    }
    window.addEventListener('focusin', focusIn, { capture: true, passive: true })
    land()
    return release
  }, [container, hash, key])
}
