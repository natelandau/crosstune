import { useUser } from '@clerk/react'
import { useMemo, type ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthContext'
import { useAuthGate } from '../auth/useAuthGate'
import { SIGN_UP_PATH } from '../auth/links'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'
import { Splash } from './Splash'

/** The sign-in gate, which makes its decisions through `useAuthGate`. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, userId, getToken, staleSession } = useAuthGate()
  const name = useUser().user?.fullName ?? null
  const offline = state === 'offline'
  // Held across renders, so the app under it re-renders only when the session changes.
  const session = useMemo(
    () => (userId ? { userId, getToken, offline, name } : null),
    [userId, getToken, offline, name],
  )
  if ((state === 'signedIn' || offline) && session) {
    return <AuthProvider value={session}>{children}</AuthProvider>
  }
  if (state === 'signIn') {
    // Clerk's footer links leave by a full page load, so the address read here stays current.
    return location.pathname.replace(/\/$/, '') === SIGN_UP_PATH ? (
      <SignUp staleSession={staleSession} />
    ) : (
      <SignIn staleSession={staleSession} />
    )
  }
  return <Splash />
}
