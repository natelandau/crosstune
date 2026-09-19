import { useIonToast } from '@ionic/react'
import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'
import { WIDE_QUERY } from '../platform/frame'
import { matches } from '../platform/mediaQuery'

export const TOAST_MS = 8000

// The tab bar comes back within a frame or two of the mode ending. The cap is only there so
// that a bar which never returns cannot hold a message forever, not as a budget a slow device
// has to meet.
const ANCHOR_WAIT_MS = 1500

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * The tab bar, once it is laid out. Ionic positions a toast against its anchor's box as it
 * presents and never again, and the bar is away for as long as a screen is selecting, so a
 * message raised by the action that ends the mode waits for the bar to come back rather than
 * landing on top of it. The wide frame carries a sidebar instead of a tab bar, so there is
 * nothing to wait for and the message takes the bottom of the page.
 */
async function waitForAnchor(): Promise<HTMLElement | undefined> {
  const deadline = performance.now() + ANCHOR_WAIT_MS
  for (;;) {
    const target = document.querySelector<HTMLElement>('[data-toast-anchor]')
    if (target?.offsetParent) return target
    // Nothing is on its way: the wide frame carries a sidebar rather than a tab bar, and a
    // page with no tab bar in it at all has none to wait for.
    if (!target || matches(WIDE_QUERY) || performance.now() >= deadline) return undefined
    await nextFrame()
  }
}

type ToastFn = (options: { message: string; undo?: () => void }) => void

const ToastContext = createContext<ToastFn | null>(null)

/**
 * Owns the app's one ion-toast overlay. Mounted once near the router root so every screen's
 * useToast() shares it, rather than each screen racing its own overlay and chain.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [present, dismiss] = useIonToast()
  // useIonToast's own overlap guard only applies after its internal controller.create()
  // resolves, which is too late to stop several calls in one tick from racing to present.
  // Chaining every call through one ref-held promise runs them in call order instead.
  const chain = useRef(Promise.resolve())
  // A call captures the counter's value when made; if a later call has since bumped it, this
  // one was superseded before its turn and must never present, not even for the instant
  // between its dismiss and its present, or a burst would flash every message in it.
  const requestId = useRef(0)

  const toast = useCallback<ToastFn>(
    ({ message, undo }) => {
      const id = ++requestId.current
      chain.current = chain.current
        .then(() => dismiss())
        .then(() => waitForAnchor())
        .then((anchor) => {
          if (id !== requestId.current) return
          return present({
            message,
            duration: TOAST_MS,
            position: 'bottom',
            positionAnchor: anchor,
            buttons: undo ? [{ text: 'Undo', role: 'undo', handler: undo }] : undefined,
          })
        })
        .catch(() => {})
    },
    [dismiss, present],
  )

  return <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
}

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastFn {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast must be used within a ToastProvider')
  return toast
}
