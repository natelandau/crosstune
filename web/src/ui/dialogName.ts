import { useEffect, type RefObject } from 'react'

/**
 * Keep a dialog named for the title it is showing now. ion-modal reads `aria-label` from its
 * host once, while it loads, copies it onto the element inside its shadow root that carries
 * `role="dialog"`, and takes the attribute off the host; it never reads the host again. A modal
 * mounted with its screen therefore keeps the name it first rendered with, which for a title
 * drawn from a live row is the value before any edit to it. The `aria-label` prop on the modal
 * is where that first name comes from, and this puts every later title in its place.
 *
 * Ionic's own re-renders, for a breakpoint or a present, leave the name alone: Stencil skips
 * writing an attribute whose value has not changed, and the value it holds never changes.
 */
export function useDialogName(modal: RefObject<HTMLIonModalElement | null>, title: string): void {
  useEffect(() => {
    const element = modal.current
    if (!element) return
    let live = true
    // The element carries componentOnReady once Ionic has defined it, and its shadow root holds
    // nothing before then.
    void Promise.resolve(element.componentOnReady?.()).then(() => {
      if (!live) return
      element.shadowRoot?.querySelector('[role="dialog"]')?.setAttribute('aria-label', title)
    })
    return () => {
      live = false
    }
  }, [modal, title])
}
