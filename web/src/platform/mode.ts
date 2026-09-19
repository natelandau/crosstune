/** Ionic's visual mode, detected by Ionic from the platform and never forced. */
export type Mode = 'ios' | 'md'

// setupIonicReact stamps the mode as a class on <html> before the first render.
export function getMode(): Mode {
  return document.documentElement.classList.contains('ios') ? 'ios' : 'md'
}
