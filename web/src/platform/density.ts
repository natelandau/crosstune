import { useLayoutEffect, useSyncExternalStore } from 'react'
import { MOUSE_QUERY } from './pointer'
import { useMediaQuery } from './mediaQuery'

export type Density = 'touch' | 'pointer'

/** Which target sizes apply, following the live pointer; `html[data-density]` tracks it for CSS. */
export function useDensity(): Density {
  const density: Density = useMediaQuery(MOUSE_QUERY) ? 'pointer' : 'touch'
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.density = density
    return () => {
      delete root.dataset.density
    }
  }, [density])
  return density
}

function subscribeDensity(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-density'],
  })
  return () => observer.disconnect()
}

/** The density stamped on the root, without owning it. For leaf components that must not re-stamp it. */
export function useStampedDensity(): Density {
  return useSyncExternalStore(subscribeDensity, () =>
    document.documentElement.dataset.density === 'pointer' ? 'pointer' : 'touch',
  )
}
