import { useCallback, useState } from 'react'

export type Mode = 'loops' | 'speed' | 'pitch'

export const MODE_KEY = 'crosstune.practiceMode'

export const MODES: readonly Mode[] = ['loops', 'speed', 'pitch']

function readMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    return MODES.find((mode) => mode === stored) ?? 'loops'
  } catch {
    return 'loops'
  }
}

/** The chosen mode, kept across visits where storage allows it. */
export function usePracticeMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(readMode)
  const choose = useCallback((next: Mode) => {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // The choice still holds for this visit.
    }
  }, [])
  return [mode, choose]
}
