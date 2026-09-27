import { IonModal } from '@ionic/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { visibleMain } from '../../ui/useShortcut'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { RecordingScreen } from './RecordingScreen'
import {
  RecordingScreenContext,
  type HeldSettings,
  type RecordingScreen as Screen,
} from './useRecordingScreen'

/**
 * Holds the one recording screen, a full-screen modal over whatever tab is open, so every
 * control that opens it reaches the same one and closing it returns the musician where they
 * were. It shows the player's current recording and closes when the player moves on.
 */
export function RecordingScreenProvider({ children }: { children: ReactNode }) {
  const player = usePlayer()
  const modal = useRef<HTMLIonModalElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  // The id outlives `open` through the closing animation, so the screen does not empty
  // before it leaves.
  const [shown, setShown] = useState<{ id: string; open: boolean } | null>(null)

  const open = useCallback(
    (id: string) => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      const item = { kind: 'recording', id } as const
      // Inside the tap, so the player primes the engine's audio while iOS still allows it.
      if (!isPlaying(player, item)) player.play(item)
      setShown({ id, open: true })
    },
    [player],
  )
  const close = useCallback(() => {
    setShown((current) => (current?.open ? { ...current, open: false } : current))
  }, [])

  // A recording the player has moved on from (closed, replaced, or deleted) is not the one
  // this screen drives, so the screen goes with it.
  if (shown?.open && !isPlaying(player, { kind: 'recording', id: shown.id })) {
    setShown({ ...shown, open: false })
  }

  const latest = useRef(shown)
  useLayoutEffect(() => {
    latest.current = shown
  })
  const dismissed = () => {
    // A screen opened again while this one was still leaving belongs to that newer open.
    if (latest.current?.open) return
    setShown(null)
    const target = opener.current?.isConnected ? opener.current : visibleMain()
    target?.focus()
  }

  // Read by the dock inside its own effects, never rendered, so a ref rather than state.
  const heldSettings = useRef(new Map<string, HeldSettings>())
  const held = useCallback((id: string) => heldSettings.current.get(id) ?? null, [])
  const hold = useCallback((id: string, settings: HeldSettings | null) => {
    if (settings) heldSettings.current.set(id, settings)
    else heldSettings.current.delete(id)
  }, [])

  const value = useMemo<Screen>(() => ({ open, close, held, hold }), [open, close, held, hold])

  return (
    <RecordingScreenContext.Provider value={value}>
      {children}
      <IonModal
        ref={modal}
        isOpen={shown?.open ?? false}
        // Escape and the hardware back button dismiss without passing through `close`.
        onWillDismiss={close}
        onDidDismiss={dismissed}
      >
        {shown ? <RecordingScreen id={shown.id} modal={modal} onClose={close} /> : null}
      </IonModal>
    </RecordingScreenContext.Provider>
  )
}
