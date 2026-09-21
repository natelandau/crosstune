import { MOUSE_QUERY } from '../platform/pointer'

/**
 * Stubs the media query `usePointer` reads so a component under test sees a touch pointer.
 * Headless Chromium reports a mouse-capable pointer by default, so anything that branches on
 * touch, such as a sheet's breakpoints, needs this to reach that branch at all. Call the
 * returned function to put the real query back.
 */
export function forceTouch(): () => void {
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
  return () => {
    window.matchMedia = original
  }
}
