import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A horizontal row of capsules that never wraps. A row of one-word capsules can still outrun a
 * narrow phone at the roomy text size, and a control that spills onto a second line reads as two
 * groups rather than one, so the row scrolls instead and fades at its end while there is more to
 * reach.
 *
 * The chosen control is brought into view, so a filter restored from the last session never reads
 * as though nothing is chosen.
 */
export function Rail({ label, children }: { label: string; children: ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState(false)

  const updateFade = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const overflow = rail.scrollWidth - rail.clientWidth > 1
    // In RTL, scrollLeft runs zero at the start to negative at the end, mirroring LTR's
    // zero-to-positive, so its absolute value measures distance from the start either way.
    const atEnd = Math.abs(rail.scrollLeft) >= rail.scrollWidth - rail.clientWidth - 1
    setFade(overflow && !atEnd)
  }, [])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    // The chips change width with the text size setting and with web fonts as they load, neither
    // of which renders the rail, so it watches their boxes rather than its own renders.
    const sizes = new ResizeObserver(updateFade)
    const observe = () => {
      sizes.disconnect()
      sizes.observe(rail)
      for (const chip of rail.children) sizes.observe(chip)
    }
    observe()
    updateFade()
    const chips = new MutationObserver(observe)
    chips.observe(rail, { childList: true })
    rail.addEventListener('scroll', updateFade, { passive: true })
    return () => {
      sizes.disconnect()
      chips.disconnect()
      rail.removeEventListener('scroll', updateFade)
    }
  }, [updateFade])

  const shown = useRef<Element | null>(null)
  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const pressed = rail.querySelector('[aria-pressed="true"]')
    if (pressed === shown.current) return
    shown.current = pressed
    if (!(pressed instanceof HTMLElement)) return
    const railBox = rail.getBoundingClientRect()
    const style = getComputedStyle(rail)
    // Inside the gutters, so a chosen last chip scrolls the rail to its end and sheds the fade.
    const right = railBox.right - parseFloat(style.paddingRight)
    const left = railBox.left + parseFloat(style.paddingLeft)
    const box = pressed.getBoundingClientRect()
    // Scrolling by the overhang rather than to an offset reads the same in either direction,
    // where scrollLeft runs positive one way and negative the other.
    if (box.right > right) rail.scrollLeft += box.right - right
    else if (box.left < left) rail.scrollLeft -= left - box.left
    // The scroll event lands a frame later, and the fade would be wrong for that frame.
    updateFade()
  })

  return (
    <div
      ref={railRef}
      role="group"
      aria-label={label}
      data-fade={fade || undefined}
      className="rail flex [scrollbar-width:none] gap-1 overflow-x-auto px-(--form-gutter)"
    >
      {children}
    </div>
  )
}
