import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import type { Store } from './store'
import { StoreProvider, useStore } from './StoreProvider'

const built = vi.hoisted(() => ({
  revenueCatStore: vi.fn((apiKey: string, appUserId: string) => ({ apiKey, appUserId })),
}))

vi.mock('./revenueCatStore', () => built)

function renderStore(userId: string, store?: Store | null) {
  const session = { userId, getToken: async () => null, offline: false, name: null }
  const view = renderHook(() => useStore(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider value={session}>
        <StoreProvider store={store}>{children}</StoreProvider>
      </AuthProvider>
    ),
  })
  return {
    ...view,
    signIn(next: string) {
      session.userId = next
      view.rerender()
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('StoreProvider', () => {
  it('offers no store when the build has no web key', () => {
    vi.stubEnv('VITE_REVENUECAT_WEB_KEY', '')
    expect(renderStore('user_1').result.current).toBeNull()
    expect(built.revenueCatStore).not.toHaveBeenCalled()
  })

  it('offers no store when no user is signed in', () => {
    vi.stubEnv('VITE_REVENUECAT_WEB_KEY', 'rcb_key')
    expect(renderStore('').result.current).toBeNull()
    expect(built.revenueCatStore).not.toHaveBeenCalled()
  })

  it('offers an injected store in place of RevenueCat', () => {
    vi.stubEnv('VITE_REVENUECAT_WEB_KEY', 'rcb_key')
    const store: Store = { offers: async () => [], purchase: async () => 'completed' }
    expect(renderStore('user_1', store).result.current).toBe(store)
    expect(renderStore('user_1', null).result.current).toBeNull()
    expect(built.revenueCatStore).not.toHaveBeenCalled()
  })

  it('builds a new store when the signed-in user changes', () => {
    vi.stubEnv('VITE_REVENUECAT_WEB_KEY', 'rcb_key')
    const { result, signIn } = renderStore('user_1')
    const first = result.current
    expect(first).not.toBeNull()
    signIn('user_1')
    expect(result.current).toBe(first)

    signIn('user_2')

    expect(result.current).not.toBe(first)
    expect(built.revenueCatStore).toHaveBeenLastCalledWith('rcb_key', 'user_2')
  })
})
