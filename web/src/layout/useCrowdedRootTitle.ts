import { useLayoutEffect, useState, type RefObject } from 'react'
import { useLatest } from '../ui/useLatest'

/**
 * Whether the phone row's title would truncate with one more icon button among its buttons. A
 * screen moves a button into its More menu while this holds. It measures against the room the
 * title would have with the button back, so moving the button out never frees enough room to
 * bring it straight back. Off while `enabled` is false, as on a frame with no title row.
 */
export function useCrowdedRootTitle(
  titleRef: RefObject<HTMLHeadingElement | null>,
  enabled: boolean,
): boolean {
  const [crowded, setCrowded] = useState(false)
  const crowdedRef = useLatest(crowded)

  useLayoutEffect(() => {
    const title = titleRef.current
    // The title's lane: the flex child that takes the row's spare width.
    const lane = title?.parentElement?.parentElement
    if (!enabled || !title || !lane) {
      setCrowded(false)
      return
    }
    const measure = () => {
      const row = lane.parentElement
      if (!row) return
      const style = getComputedStyle(row)
      // One icon button and the gap before it, as the bar spaces its buttons.
      const slot = parseFloat(style.getPropertyValue('--target-control')) + parseFloat(style.gap)
      const head = title.parentElement!
      // The title at full width, with the badge beside it.
      const needed = head.scrollWidth - title.clientWidth + title.scrollWidth
      const room = lane.clientWidth - (crowdedRef.current ? slot : 0)
      setCrowded(needed > room)
    }
    measure()
    const sizes = new ResizeObserver(measure)
    sizes.observe(lane)
    sizes.observe(title)
    // A late web font changes the title's width without resizing anything observed.
    document.fonts.addEventListener('loadingdone', measure)
    return () => {
      sizes.disconnect()
      document.fonts.removeEventListener('loadingdone', measure)
    }
  }, [titleRef, enabled, crowdedRef])

  return enabled && crowded
}
