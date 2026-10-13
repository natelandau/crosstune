import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAuthSession } from '../auth/AuthContext'
import { revenueCatStore } from './revenueCatStore'
import type { Store } from './store'
import { storeConfig } from './storeConfig'

const StoreContext = createContext<Store | null>(null)

/**
 * Offers the web store to the Plan sheet. With no `store`, it builds RevenueCat's for the
 * signed-in user, or none when the build has no web key.
 */
export function StoreProvider({
  store,
  children,
}: {
  /** Stands in for the store, for a test; null means purchasing is unavailable. */
  store?: Store | null
  children: ReactNode
}) {
  const { userId } = useAuthSession()
  const built = useMemo(() => {
    if (store !== undefined) return store
    const { webKey } = storeConfig()
    return webKey && userId ? revenueCatStore(webKey, userId) : null
  }, [store, userId])
  return <StoreContext value={built}>{children}</StoreContext>
}

/** Null when no web key is configured or no user is signed in. */
// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): Store | null {
  return useContext(StoreContext)
}
