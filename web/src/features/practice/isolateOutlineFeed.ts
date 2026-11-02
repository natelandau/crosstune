import type { IsolateOutline } from '../player/isolate/isolateStage'

/** One axis of the outline, read by the canvas that draws it and nothing else. */
export interface OutlineSource {
  subscribe: (onChange: () => void) => () => void
  get: () => Float32Array | null
}

/** The latest outline the engine reported, held outside React so each one redraws only the
 * canvases. */
export interface OutlineFeed {
  push: (outline: IsolateOutline) => void
  pan: OutlineSource
  freq: OutlineSource
}

export function createOutlineFeed(): OutlineFeed {
  let latest: IsolateOutline | null = null
  const listeners = new Set<() => void>()
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }
  return {
    push(outline) {
      latest = outline
      for (const onChange of listeners) onChange()
    },
    pan: { subscribe, get: () => latest?.pan ?? null },
    freq: { subscribe, get: () => latest?.freq ?? null },
  }
}
