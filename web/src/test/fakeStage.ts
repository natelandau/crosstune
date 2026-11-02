import { vi } from 'vitest'
import type { IsolateOutline } from '../features/player/isolate/isolateStage'
import type { AudioStage } from '../features/player/audioStage'

/** An audio stage whose every call is a spy, with `emitOutline` standing in for the worklet's
 * outline messages. */
export function fakeStage() {
  const outlineListeners = new Set<(outline: IsolateOutline) => void>()
  const setTranspose = vi.fn()
  const start = vi.fn(async () => {})
  const stop = vi.fn()
  const dispose = vi.fn()
  const setSetting = vi.fn()
  const setEngaged = vi.fn()
  const reset = vi.fn()
  const onOutline = vi.fn((fn: (outline: IsolateOutline) => void) => {
    outlineListeners.add(fn)
    return () => {
      outlineListeners.delete(fn)
    }
  })
  const stage: AudioStage = {
    setTranspose,
    start,
    stop,
    dispose,
    isolate: { node: {} as AudioNode, setSetting, setEngaged, reset, onOutline },
  }
  return {
    stage,
    setTranspose,
    start,
    stop,
    dispose,
    setSetting,
    setEngaged,
    reset,
    onOutline,
    emitOutline: (outline: IsolateOutline) => {
      for (const fn of outlineListeners) fn(outline)
    },
  }
}
