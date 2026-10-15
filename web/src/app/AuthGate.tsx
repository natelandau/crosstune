import type { ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthContext'
import { useAuthGate } from '../auth/useAuthGate'
import { SIGN_UP_PATH } from '../auth/links'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'
import { Splash } from './Splash'

/** The sign-in gate, which makes its decisions through `useAuthGate`. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, userId, getToken, staleSession } = useAuthGate()
  if ((state === 'signedIn' || state === 'offline') && userId) {
    return (
      <AuthProvider value={{ userId, getToken, offline: state === 'offline' }}>
        {children}
      </AuthProvider>
    )
  }
  if (state === 'signIn') {
    // Clerk's footer links leave by a full page load, so the address read here stays current.
    return location.pathname === SIGN_UP_PATH ? (
      <SignUp staleSession={staleSession} />
    ) : (
      <SignIn staleSession={staleSession} />
    )
  }
  return <Splash />
}
