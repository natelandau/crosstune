// Clip playback the hero and the feature sections share: when a clip plays, its controls' labels,
// and following the reduced-motion setting.

/** A clip control's name: what pressing it does next. */
export const PAUSE = 'Pause'
export const PLAY = 'Play'

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

/**
 * Calls `onChange` whenever `el` enters or leaves the viewport; returns a function that stops
 * watching.
 */
export type Observe = (el: Element, onChange: (visible: boolean) => void) => () => void

const intersection: Observe = (el, onChange) => {
  const observer = new IntersectionObserver((entries) => {
    const last = entries.at(-1)
    if (last) onChange(last.isIntersecting)
  })
  observer.observe(el)
  return () => observer.disconnect()
}

/**
 * Plays `video` while it intersects the viewport and the document is visible, and pauses it
 * otherwise. The clip's `src` comes from `data-src` the first time it plays, so nothing downloads
 * for a clip nobody scrolls to, or for one in a layout that is `display: none`. Under reduced
 * motion it never plays. Returns a disposer that stops watching and pauses the clip.
 */
export function playWhenVisible(
  video: HTMLVideoElement,
  opts: { reducedMotion: boolean; observe?: Observe },
): () => void {
  if (opts.reducedMotion) return () => {}
  const doc = video.ownerDocument
  let onScreen = false

  const update = () => {
    if (onScreen && doc.visibilityState === 'visible') {
      const src = video.dataset.src
      if (!video.hasAttribute('src') && src) video.src = src
      // Autoplay can be refused (for example in low-power mode); the poster stays up.
      video.play()?.catch(() => {})
    } else {
      video.pause()
    }
  }

  const stop = (opts.observe ?? intersection)(video, (visible) => {
    if (visible === onScreen) return
    onScreen = visible
    update()
  })
  doc.addEventListener('visibilitychange', update)

  return () => {
    stop()
    doc.removeEventListener('visibilitychange', update)
    video.pause()
  }
}
