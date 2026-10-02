import { IonModal } from '@ionic/react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { visibleMain } from '../../ui/useShortcut'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { RecordingScreen } from './RecordingScreen'
import {
  RecordingScreenContext,
  type HeldSettings,
  type RecordingScreen as Screen,
} from './useRecordingScreen'
import { useLatest } from '../../ui/useLatest'

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
  // before it leaves. Each open counts up, so opening again starts the screen afresh in the
  // view it asked for.
  const [shown, setShown] = useState<{
    id: string
    open: boolean
    view?: 'practice'
    opening: number
  } | null>(null)

  const open = useCallback(
    (id: string, view?: 'practice') => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      const item = { kind: 'recording', id } as const
      // Inside the tap, so the player primes the engine's audio while iOS still allows it.
      if (!isPlaying(player, item)) player.play(item)
      setShown((current) => ({ id, open: true, view, opening: (current?.opening ?? 0) + 1 }))
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

  const latestRef = useLatest(shown)
  const dismissed = () => {
    // A screen opened again while this one was still leaving belongs to that newer open.
    if (latestRef.current?.open) return
    setShown(null)
    const target = opener.current?.isConnected ? opener.current : visibleMain()
    target?.focus()
  }

  // A ref map, so the dock reads a hold inside its effects without re-rendering; renders that
  // show a hold subscribe through `useHeldSettings`.
  const heldSettings = useRef(new Map<string, HeldSettings>())
  const listeners = useRef(new Set<() => void>())
  const held = useCallback((id: string) => heldSettings.current.get(id) ?? null, [])
  const hold = useCallback((id: string, settings: HeldSettings | null) => {
    if (settings) heldSettings.current.set(id, settings)
    else if (!heldSettings.current.delete(id)) return
    for (const listener of listeners.current) listener()
  }, [])
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo<Screen>(
    () => ({ open, close, held, hold, subscribe }),
    [open, close, held, hold, subscribe],
  )

  return (
    <RecordingScreenContext.Provider value={value}>
      {children}
      <IonModal
        ref={modal}
        className="recording-modal"
        isOpen={shown?.open ?? false}
        // Escape and the hardware back button dismiss without passing through `close`.
        onWillDismiss={close}
        onDidDismiss={dismissed}
      >
        {shown ? (
          <RecordingScreen
            key={shown.opening}
            id={shown.id}
            view={shown.view}
            modal={modal}
            onClose={close}
          />
        ) : null}
      </IonModal>
    </RecordingScreenContext.Provider>
  )
}
