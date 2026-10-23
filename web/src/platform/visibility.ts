import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** Whether the page is shown, by `document.visibilityState` rather than window focus. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, () => document.visibilityState === 'visible')
}
