import { onTestFinished } from 'vitest'
import { MOUSE_QUERY } from '../platform/pointer'

/**
 * Stubs the media query `usePointer` reads so a component under test sees a touch pointer.
 * Headless Chromium reports a mouse-capable pointer by default, so anything that branches on
 * touch, such as a sheet's breakpoints, needs this to reach that branch at all. The real query
 * comes back when the current test finishes. Call it from a test or a `beforeEach`.
 */
export function forceTouch() {
  const original = window.matchMedia
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : original.call(window, query)
  onTestFinished(() => {
    window.matchMedia = original
  })
}
