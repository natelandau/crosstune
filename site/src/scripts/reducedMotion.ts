// Following the reduced-motion setting while the page is open.

/** The part of a `MediaQueryList` the page reads. */
export type MediaQuery = {
  matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/**
 * Mounts with whether the visitor asks for reduced motion, then disposes and mounts again each
 * time that setting changes. Returns a disposer.
 */
export function followReducedMotion(
  query: MediaQuery,
  mount: (reducedMotion: boolean) => () => void,
): () => void {
  let dispose = mount(query.matches)
  const onChange = () => {
    dispose()
    dispose = mount(query.matches)
  }
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
    dispose()
  }
}
