import { useIonViewWillEnter, useIonViewWillLeave } from '@ionic/react'
import { useEffect, useState, type RefObject } from 'react'
import { usePointer } from '../platform/pointer'

/**
 * The overlays that take the keyboard while open. A toast is left out: it is non-modal, so the
 * page behind it stays in reach.
 */
export const BLOCKING_OVERLAYS = 'ion-modal, ion-popover, ion-alert, ion-action-sheet, ion-loading'

/** True when the keystroke belongs to a field the musician is typing in. */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
    element.closest('ion-input, ion-textarea, ion-searchbar') !== null
  )
}

// The router outlet keeps a page mounted, hidden, while another page covers it, so a window
// listener must stand down until its page is shown again.
function useViewActive(): boolean {
  const [active, setActive] = useState(true)
  useIonViewWillEnter(() => setActive(true))
  useIonViewWillLeave(() => setActive(false))
  return active
}

/** True while an overlay holds the keyboard, which puts the page behind it out of reach. */
export function overlayOpen(): boolean {
  return document.querySelector(`:is(${BLOCKING_OVERLAYS}):not(.overlay-hidden)`) !== null
}

/**
 * The shown screen's own landmark. Every screen has one and Ionic keeps them all mounted, so
 * the shown page is the one still laid out.
 */
export function visibleMain(): HTMLElement | null {
  const landmarks = Array.from(document.querySelectorAll<HTMLElement>('main'))
  return landmarks.find((landmark) => landmark.offsetParent !== null) ?? null
}

export function useSearchShortcut(focus: () => void): void {
  const pointer = usePointer()
  const active = useViewActive()
  useEffect(() => {
    if (pointer !== 'mouse' || !active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTextEntry(event.target) || overlayOpen()) return
      event.preventDefault()
      focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, focus, pointer])
}

/**
 * Arrow keys walk the rows inside the container. The listener sits on the window and reads the
 * ref each keystroke, so a container that mounts, unmounts, or is replaced after the first
 * render is still covered; binding to the element itself would catch only the first one.
 */
export function useRowArrowKeys(container: RefObject<HTMLElement | null>): void {
  const pointer = usePointer()
  useEffect(() => {
    if (pointer !== 'mouse') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const element = container.current
      if (!element || !element.contains(event.target as Node | null)) return
      const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-row-open]'))
      const index = rows.indexOf(document.activeElement as HTMLElement)
      if (index === -1) return
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (!next) return
      event.preventDefault()
      next.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [container, pointer])
}
