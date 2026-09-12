import { SignIn, useAuth } from '@clerk/react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
    if (isSignedIn && userId) rememberUser(userId)
    else forgetUser()
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
  return <main className="flex min-h-dvh items-center justify-center p-4">{children}</main>
}

function SignInScreen() {
  return (
    <Centered>
      <SignIn routing="hash" />
    </Centered>
  )
}

function Splash() {
  return (
    <Centered>
      <span className="loading loading-spinner loading-lg" role="status" aria-label="Loading" />
    </Centered>
  )
}
