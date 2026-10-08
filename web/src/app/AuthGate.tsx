import type { ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthContext'
import { useAuthGate } from '../auth/useAuthGate'
import { SignIn } from './SignIn'
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
  if (state === 'signIn') return <SignIn staleSession={staleSession} />
  return <Splash />
}
