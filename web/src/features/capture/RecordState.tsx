import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Source } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { ListPlaybackContext } from '../player/useListPlayback'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'

export interface RecordTarget {
  tuneId: string | null
  source: Source
}

export interface LastSaved {
  recordingId: string
  /** Epoch milliseconds when the take was marked, so a list can tell a fresh take from one it already marked. */
  at: number
}

export interface RecordState {
  /** Opens the recorder. A tune id files the recording under that tune. */
  start: (options: { tuneId?: string; source: Source }) => void
  /** True while the recorder is up, for anything that must not appear over it. */
  recording: boolean
  /** What the open recorder files under; null while closed. */
  target: RecordTarget | null
  /** Ends the recorder. A take reported saved becomes `lastSaved`, if Stop has not marked it. */
  close: (saved?: { recordingId: string } | null) => void
  /** Marks the recording Stop is saving as `lastSaved` before it is written, so its row shows
   * as new from its first render. */
  saving: (recordingId: string) => void
  /** The newest take Stop marked or a save reported, null until one is. A take marked at Stop
   * whose write fails names a recording no row has. */
  lastSaved: LastSaved | null
}

const RecordStateContext = createContext<RecordState | null>(null)

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useRecordState(): RecordState {
  const state = useContext(RecordStateContext)
  if (!state) throw new Error('useRecordState must be used inside RecordStateProvider')
  return state
}

/** `lastSaved`, or null, also outside a provider, for a row that may be the new take. */
// eslint-disable-next-line react-refresh/only-export-components
export function useLastSaved(): LastSaved | null {
  return useContext(RecordStateContext)?.lastSaved ?? null
}

/**
 * Holds the one recorder's state, so every control that starts a recording reaches the same one.
 * The recorder itself is drawn from `target`.
 */
export function RecordStateProvider({ children }: { children: ReactNode }) {
  const player = usePlayer()
  // Read without the hook, which throws outside its provider: list playback is optional here,
  // and a tree without it, such as a hook test's, has no list to follow.
  const listRef = useLatest(useContext(ListPlaybackContext))
  const [target, setTarget] = useState<RecordTarget | null>(null)
  const [lastSaved, setLastSaved] = useState<LastSaved | null>(null)
  // A ref, because two Record presses in one tick both read the same committed state.
  const open = useRef(false)

  const start = useCallback(
    ({ tuneId, source }: { tuneId?: string; source: Source }) => {
      // A second start while the recorder is up would restart a live recording under it.
      if (open.current) return
      open.current = true
      // iOS only unlocks audio inside the gesture that asked for it, so this runs before any await.
      unlockAudioContext()
      // A take starts afresh, so a stopped list goes with its message.
      listRef.current?.end()
      player.close()
      setTarget({ tuneId: tuneId ?? null, source })
    },
    [player, listRef],
  )
  const mark = useCallback((recordingId: string) => {
    // The same take marked twice, by Stop and then by its save, stays one new take.
    setLastSaved((current) =>
      current?.recordingId === recordingId ? current : { recordingId, at: Date.now() },
    )
  }, [])
  const close = useCallback(
    (saved?: { recordingId: string } | null) => {
      open.current = false
      setTarget(null)
      if (saved) mark(saved.recordingId)
    },
    [mark],
  )
  const value = useMemo<RecordState>(
    () => ({ start, recording: target !== null, target, close, saving: mark, lastSaved }),
    [start, target, close, mark, lastSaved],
  )

  return <RecordStateContext.Provider value={value}>{children}</RecordStateContext.Provider>
}
