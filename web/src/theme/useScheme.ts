import { useSyncExternalStore } from 'react'
import type { Scheme } from './tokens'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] })
  return () => observer.disconnect()
}

const read = (): Scheme => (document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'light')

/** The scheme the app is drawn in right now, following a change of appearance. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, read, () => 'light')
}
