import { SignIn, useAuth } from '@clerk/react'
import { IonSpinner } from '@ionic/react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Lockup } from '../ui/Mark'
import { clearSearchQuery } from '../features/catalog/searchSession'
import { AuthProvider } from './AuthContext'
import { forgetUser, rememberedUser, rememberUser } from './session'

// A phone on a flaky jam-site network can take this long to learn Clerk is unreachable.
export const CLERK_LOAD_GRACE_MS = 5000

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const [graceOver, setGraceOver] = useState(false)

  useEffect(() => {
    if (isLoaded) return
    const timer = setTimeout(() => setGraceOver(true), CLERK_LOAD_GRACE_MS)
    return () => clearTimeout(timer)
  }, [isLoaded])

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn && userId) {
      rememberUser(userId)
    } else {
      forgetUser()
      // Whoever signs in next in this tab must not inherit the previous user's search.
      clearSearchQuery()
    }
  }, [isLoaded, isSignedIn, userId])

  const latest = useRef<() => Promise<string | null>>(async () => null)
  useEffect(() => {
    latest.current = isLoaded && isSignedIn ? () => getToken() : async () => null
  }, [isLoaded, isSignedIn, getToken])
  const stableGetToken = useCallback(() => latest.current(), [])

  if (isLoaded && isSignedIn && userId) {
    return (
      <AuthProvider value={{ userId, getToken: stableGetToken, offline: false }}>
        {children}
      </AuthProvider>
    )
  }
  if (isLoaded) return <SignInScreen />

  const remembered = rememberedUser()
  if (remembered && (!navigator.onLine || graceOver)) {
    return (
      <AuthProvider value={{ userId: remembered, getToken: stableGetToken, offline: true }}>
        {children}
      </AuthProvider>
    )
  }
  return <Splash />
}

function Centered({ children }: { children: ReactNode }) {
  return (
    // Ionic pins the body and clips ion-app, so a tall form or an open keyboard needs its own
    // scroll container.
    <div className="h-full overflow-y-auto">
      <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-4">
        {children}
      </main>
    </div>
  )
}

function SignInScreen() {
  return (
    <Centered>
      <Lockup className="type-title" />
      <SignIn routing="hash" />
    </Centered>
  )
}

function Splash() {
  return (
    <Centered>
      <div role="status" aria-label="Loading">
        <IonSpinner />
      </div>
    </Centered>
  )
}
