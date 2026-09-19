import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePlayer } from '../player/usePlayer'
import { unlockAudioContext } from './audioContext'
import { RecordModal } from './RecordModal'

export interface RecordTarget {
  songId: string | null
}

interface Record {
  /** Opens the record modal. A song id files the recording under that song. */
  start: (songId?: string) => void
  /** True while the record modal is up, for anything that must not appear over it. */
  recording: boolean
}

const RecordContext = createContext<Record | null>(null)

// This file pairs a provider component with its hook, the point of a context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useRecord(): Record {
  const record = useContext(RecordContext)
  if (!record) throw new Error('useRecord must be used inside RecordProvider')
  return record
}

/** Holds the one record modal, so every control that starts a recording reaches the same one. */
export function RecordProvider({ children }: { children: ReactNode }) {
  const player = usePlayer()
  const [target, setTarget] = useState<RecordTarget | null>(null)
  // A ref, because two Record presses in one tick both read the same committed state.
  const open = useRef(false)

  const start = useCallback(
    (songId?: string) => {
      // A second start while the modal is up would restart a live recording under it.
      if (open.current) return
      open.current = true
      // iOS only unlocks audio inside the gesture that asked for it, so this runs before any await.
      unlockAudioContext()
      player.close()
      setTarget({ songId: songId ?? null })
    },
    [player],
  )
  const close = useCallback(() => {
    open.current = false
    setTarget(null)
  }, [])
  const value = useMemo<Record>(() => ({ start, recording: target !== null }), [start, target])

  return (
    <RecordContext.Provider value={value}>
      {children}
      <RecordModal target={target} onClose={close} />
    </RecordContext.Provider>
  )
}
