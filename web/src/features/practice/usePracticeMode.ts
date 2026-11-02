import { useCallback, useState } from 'react'
import { readStored, writeStored } from '../../platform/storage'

export type Mode = 'loops' | 'speed' | 'pitch' | 'isolate'

export const MODE_KEY = 'crosstune.practiceMode'

export const MODES: readonly Mode[] = ['loops', 'speed', 'pitch', 'isolate']

/** Every mode, or every mode but Isolate where nothing can isolate. */
export function availableModes(canIsolate: boolean): readonly Mode[] {
  return canIsolate ? MODES : MODES.filter((mode) => mode !== 'isolate')
}

function readMode(): Mode {
  const stored = readStored(MODE_KEY)
  return MODES.find((mode) => mode === stored) ?? 'loops'
}

/** The chosen mode, kept across visits where storage allows it. */
export function usePracticeMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(readMode)
  const choose = useCallback((next: Mode) => {
    setMode(next)
    writeStored(MODE_KEY, next)
  }, [])
  return [mode, choose]
}
