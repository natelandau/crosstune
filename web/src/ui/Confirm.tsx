import { useIonActionSheet, useIonAlert } from '@ionic/react'
import { useCallback, useRef } from 'react'
import { usePointer } from '../platform/pointer'

export interface ConfirmOptions {
  title: string
  message: string
  /** The destructive button's label, a bare verb: Delete, Remove. */
  action: string
}

/**
 * A destructive confirmation: an action sheet from the bottom on touch, an alert on mouse.
 * Resolves true only when the named action is chosen.
 */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const pointer = usePointer()
  const [presentSheet] = useIonActionSheet()
  const [presentAlert] = useIonAlert()
  // Ionic's present hooks silently ignore a call while their previous overlay is still
  // dismissing, which would leave that confirmation's promise pending forever. Each call waits
  // for the one before it to finish dismissing.
  const previous = useRef(Promise.resolve())
  // True from a call until that call's own promise settles. A second call before the first is
  // answered is one impatient double press, not a second question, so it declines at once
  // rather than putting another dialog behind the one already up.
  const asking = useRef(false)

  return useCallback(
    ({ title, message, action }) => {
      if (asking.current) return Promise.resolve(false)
      asking.current = true
      return new Promise<boolean>((resolve) => {
        // A chosen button settles the call, and its overlay's later dismissal must not run this
        // again: by then the next call may own the flag, and clearing it would leave that
        // call's dialog unguarded.
        let done = false
        const settle = (ok: boolean) => {
          if (done) return
          done = true
          asking.current = false
          resolve(ok)
        }
        previous.current = previous.current.then(
          () =>
            new Promise<void>((dismissed) => {
              const onDidDismiss = () => {
                settle(false)
                dismissed()
              }
              if (pointer === 'touch') {
                presentSheet({
                  header: title,
                  subHeader: message,
                  buttons: [
                    { text: action, role: 'destructive', handler: () => settle(true) },
                    { text: 'Cancel', role: 'cancel', handler: () => settle(false) },
                  ],
                  onDidDismiss,
                }).catch(onDidDismiss)
                return
              }
              presentAlert({
                header: title,
                message,
                buttons: [
                  { text: 'Cancel', role: 'cancel', handler: () => settle(false) },
                  { text: action, role: 'destructive', handler: () => settle(true) },
                ],
                onDidDismiss,
              }).catch(onDidDismiss)
            }),
        )
      })
    },
    [pointer, presentAlert, presentSheet],
  )
}
