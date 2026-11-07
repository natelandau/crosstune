import { useState } from 'react'

export type Mode = 'speed' | 'pitch' | 'isolate' | 'loops'

export const MODES: readonly Mode[] = ['speed', 'pitch', 'isolate', 'loops']

/** Every mode, or every mode but Isolate where nothing can isolate. */
export function availableModes(canIsolate: boolean): readonly Mode[] {
  return canIsolate ? MODES : MODES.filter((mode) => mode !== 'isolate')
}

/** The chosen mode, held while the page is open. Every page opens on Speed. */
export function usePracticeMode(): [Mode, (mode: Mode) => void] {
  return useState<Mode>('speed')
}
