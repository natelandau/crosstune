import { useAuth } from '@clerk/react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { clearSearchQueries } from '../ui/searchSession'
import { useLatest } from '../ui/useLatest'
import {
  clearAccountDeletedNotice,
  clearLocalSignOut,
  forgetUser,
  locallySignedOutUser,
  rememberedUser,
  rememberUser,
  subscribeLocalSignOut,
} from './session'

// A phone on a flaky jam-site network can take this long to learn Clerk is unreachable.
export const CLERK_LOAD_GRACE_MS = 5000

export interface GateClock {
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

const REAL_CLOCK: GateClock = {
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface AuthGateResult {
  /** `offline` is a remembered musician admitted without Clerk. */
  state: 'splash' | 'signIn' | 'signedIn' | 'offline'
  /** The signed-in or remembered user; null in `splash` and `signIn`. */
  userId: string | null
  getToken: () => Promise<string | null>
  /** Clerk still holds a session for a user this device signed out locally. */
  staleSession: boolean
}

/**
 * Every decision between Clerk's state and what the app shows. `clock` is injectable so a test
 * runs the grace period on fake time.
 */
export function useAuthGate(clock: GateClock = REAL_CLOCK): AuthGateResult {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth()
  const [graceOver, setGraceOver] = useState(false)
  const signedOutUser = useSyncExternalStore(subscribeLocalSignOut, locallySignedOutUser)
  const signedIn = isLoaded && isSignedIn && !!userId && userId !== signedOutUser
  const staleSession = isLoaded && !signedIn && !!isSignedIn && userId === signedOutUser
  // Read through a ref so a caller passing a fresh object each render cannot restart the timer.
  const clockRef = useLatest(clock)

  useEffect(() => {
    if (isLoaded) return
    const { setTimer, clearTimer } = clockRef.current
    const timer = setTimer(() => setGraceOver(true), CLERK_LOAD_GRACE_MS)
    return () => clearTimer(timer)
  }, [isLoaded, clockRef])

  useEffect(() => {
    if (!isLoaded) return
    // Once Clerk has let go of that user too, the local sign-out has nothing left to cover.
    if (!isSignedIn || userId !== signedOutUser) clearLocalSignOut()
    if (signedIn && userId) {
      rememberUser(userId)
      clearAccountDeletedNotice()
    } else {
      forgetUser()
      clearSearchQueries()
    }
  }, [isLoaded, isSignedIn, userId, signedOutUser, signedIn])

  // Clerk's form redirects instead of rendering while a session is active, so a stale session
  // is ended here. A failed attempt tries again when the window regains focus or the device
  // comes back online, so the screen never stays without a form until a reload.
  const signingOut = useRef(false)
  useEffect(() => {
    if (!staleSession) return
    const attempt = () => {
      if (signingOut.current) return
      signingOut.current = true
      void signOut()
        .catch(() => {})
        .finally(() => {
          signingOut.current = false
        })
    }
    attempt()
    window.addEventListener('focus', attempt)
    window.addEventListener('online', attempt)
    return () => {
      window.removeEventListener('focus', attempt)
      window.removeEventListener('online', attempt)
    }
  }, [staleSession, signOut])

  const tokenSource = useLatest<() => Promise<string | null>>(
    signedIn ? () => getToken() : async () => null,
  )
  const stableGetToken = useCallback(() => tokenSource.current(), [tokenSource])

  if (signedIn && userId) {
    return { state: 'signedIn', userId, getToken: stableGetToken, staleSession }
  }
  if (isLoaded) return { state: 'signIn', userId: null, getToken: stableGetToken, staleSession }

  const remembered = rememberedUser()
  if (remembered && (!navigator.onLine || graceOver)) {
    return { state: 'offline', userId: remembered, getToken: stableGetToken, staleSession }
  }
  return { state: 'splash', userId: null, getToken: stableGetToken, staleSession }
}
