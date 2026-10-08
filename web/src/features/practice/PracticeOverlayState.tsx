import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { visibleMain } from '../../platform/visibleMain'
import { useLatest } from '../../ui/useLatest'
import { ListHoldContext, ListPlaybackContext } from '../player/useListPlayback'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { usePracticeLog } from './usePracticeLog'
import {
  PracticeOverlayContext,
  PracticeOverlayShownContext,
  type HeldSettings,
  type PracticeOverlayHandle,
  type PracticeOverlayShown,
  type ShownRecording,
} from './usePracticeOverlay'

/**
 * Holds practice's one state, so every control that opens it reaches the same one
 * and closing it returns the musician where they were. It shows the player's current recording
 * and closes when the player moves on, except to the next recording of a playing list, which it
 * follows. Practice itself is drawn from `usePracticeOverlayShown`.
 */
export function PracticeOverlayStateProvider({ children }: { children: ReactNode }) {
  const player = usePlayer()
  // Read without the hook, which throws outside its provider: list playback is optional here,
  // and a tree without it, such as a hook test's, has no list to follow.
  const list = useContext(ListPlaybackContext)?.active ?? null
  const opener = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState<ShownRecording | null>(null)
  // The recordings a trim view or a sheet over practice holds, as state so the follow below
  // can read them, and as refs so a hold reaches the list in the same call.
  const [trimming, setTrimming] = useState<string | null>(null)
  const [sheetHeld, setSheetHeld] = useState<string | null>(null)
  const trimmingRef = useRef<string | null>(null)
  const sheetHeldRef = useRef<string | null>(null)
  const reportHoldingRef = useLatest(useContext(ListHoldContext))
  // Told at once rather than from an effect, so a natural end cannot land between a hold and
  // the list hearing of it.
  const reportHolding = useCallback(
    () => reportHoldingRef.current(trimmingRef.current ?? sheetHeldRef.current),
    [reportHoldingRef],
  )

  const open = useCallback(
    (id: string) => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      const item = { kind: 'recording', id } as const
      // Inside the tap, so the player primes the engine's audio while iOS still allows it.
      if (!isPlaying(player, item)) player.play(item)
      setShown((current) => ({ id, open: true, opening: (current?.opening ?? 0) + 1 }))
    },
    [player],
  )
  const close = useCallback(() => {
    setShown((current) => (current?.open ? { ...current, open: false } : current))
  }, [])

  // A recording the player has moved on from (closed, replaced, or deleted) is not the one
  // practice drives, so practice goes with it. A playing list moving on is the musician
  // working through it, so practice stays open on the next recording, unless a trim or a
  // sheet is being edited, which belongs to the recording it was opened on.
  if (shown?.open && !isPlaying(player, { kind: 'recording', id: shown.id })) {
    const next = player.item
    const follows =
      list !== null && list.message === null && trimming !== shown.id && sheetHeld !== shown.id
    if (next?.kind === 'recording' && follows) {
      setShown({ ...shown, id: next.id })
    } else {
      setShown({ ...shown, open: false })
    }
  }

  const latestRef = useLatest(shown)
  const dismissed = useCallback(() => {
    if (latestRef.current?.open) return
    setShown(null)
    const target = opener.current?.isConnected ? opener.current : visibleMain()
    target?.focus()
  }, [latestRef])

  // A ref map, so the dock reads a hold inside its effects without re-rendering.
  const heldSettings = useRef(new Map<string, HeldSettings>())
  const listeners = useRef(new Set<() => void>())
  const held = useCallback((id: string) => heldSettings.current.get(id) ?? null, [])
  const hold = useCallback(
    (id: string, settings: HeldSettings | null) => {
      if (settings) heldSettings.current.set(id, settings)
      else if (!heldSettings.current.delete(id)) return
      const isTrimming = heldSettings.current.get(id)?.trimming === true
      const current = trimmingRef.current
      trimmingRef.current = isTrimming ? id : current === id ? null : current
      setTrimming(trimmingRef.current)
      reportHolding()
      for (const listener of listeners.current) listener()
    },
    [reportHolding],
  )
  const holdEnd = useCallback(
    (id: string, holding: boolean) => {
      const current = sheetHeldRef.current
      sheetHeldRef.current = holding ? id : current === id ? null : current
      setSheetHeld(sheetHeldRef.current)
      reportHolding()
    },
    [reportHolding],
  )
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  usePracticeLog(shown?.open ? shown.id : null, { held, subscribe })

  const value = useMemo<PracticeOverlayHandle>(
    () => ({ open, close, held, hold, holdEnd, subscribe }),
    [open, close, held, hold, holdEnd, subscribe],
  )
  const shownValue = useMemo<PracticeOverlayShown>(() => ({ shown, dismissed }), [shown, dismissed])

  return (
    <PracticeOverlayContext.Provider value={value}>
      <PracticeOverlayShownContext.Provider value={shownValue}>
        {children}
      </PracticeOverlayShownContext.Provider>
    </PracticeOverlayContext.Provider>
  )
}
