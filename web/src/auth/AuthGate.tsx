import { SignIn, useAuth } from '@clerk/react'
import { IonSpinner } from '@ionic/react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Lockup } from '../ui/Mark'
import { clearSearchQuery } from '../features/catalog/searchSession'
import { AuthProvider } from './AuthContext'
import { SIGN_IN_HEADLINE, SIGN_IN_LINE } from './links'
import { PaperEcho } from './PaperEcho'
import {
  clearAccountDeletedNotice,
  clearLocalSignOut,
  forgetUser,
  hasAccountDeletedNotice,
  locallySignedOutUser,
  rememberedUser,
  rememberUser,
  subscribeLocalSignOut,
} from './session'

// A phone on a flaky jam-site network can take this long to learn Clerk is unreachable.
export const CLERK_LOAD_GRACE_MS = 5000

export const ACCOUNT_DELETED = 'Your account and all its data were deleted.'

export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const [graceOver, setGraceOver] = useState(false)
  const signedOutUser = useSyncExternalStore(subscribeLocalSignOut, locallySignedOutUser)
  const signedIn = isLoaded && isSignedIn && !!userId && userId !== signedOutUser

  useEffect(() => {
    if (isLoaded) return
    const timer = setTimeout(() => setGraceOver(true), CLERK_LOAD_GRACE_MS)
    return () => clearTimeout(timer)
  }, [isLoaded])

  useEffect(() => {
    if (!isLoaded) return
    // Once Clerk has let go of that user too, the local sign-out has nothing left to cover.
    if (!isSignedIn || userId !== signedOutUser) clearLocalSignOut()
    if (signedIn && userId) {
      rememberUser(userId)
      clearAccountDeletedNotice()
    } else {
      forgetUser()
      // Whoever signs in next in this tab must not inherit the previous user's search.
      clearSearchQuery()
    }
  }, [isLoaded, isSignedIn, userId, signedOutUser, signedIn])

  const latest = useRef<() => Promise<string | null>>(async () => null)
  useEffect(() => {
    latest.current = signedIn ? () => getToken() : async () => null
  }, [signedIn, getToken])
  const stableGetToken = useCallback(() => latest.current(), [])

  if (signedIn && userId) {
    return (
      <AuthProvider value={{ userId, getToken: stableGetToken, offline: false }}>
        {children}
      </AuthProvider>
    )
  }
  if (isLoaded) return <SignInScreen staleSession={!!isSignedIn && userId === signedOutUser} />

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

/**
 * `staleSession` means Clerk still holds a session for a user this device signed out locally.
 * Clerk's form redirects instead of rendering while a session is active, so this ends that
 * session first and shows the form once Clerk lets go. A failed attempt tries again when the
 * window regains focus or the device comes back online, so the screen never stays without a
 * form until a reload.
 */
function SignInScreen({ staleSession }: { staleSession: boolean }) {
  // A sign-in clears the notice, so it shows here on every mount and reload until then.
  const [deleted] = useState(hasAccountDeletedNotice)
  const { signOut } = useAuth()
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
  return (
    <Centered>
      <div className="flex w-full max-w-5xl flex-col items-center gap-4 min-[60rem]:flex-row min-[60rem]:justify-center min-[60rem]:gap-12">
        <PaperEcho />
        <div className="flex w-full max-w-100 flex-col items-start gap-4">
          <Lockup className="type-headline" />
          <div className="flex flex-col gap-2">
            <h1 className="type-title m-0">{SIGN_IN_HEADLINE}</h1>
            <p className="type-body m-0">{SIGN_IN_LINE}</p>
          </div>
          {deleted ? (
            <p role="status" className="type-body m-0">
              {ACCOUNT_DELETED}
            </p>
          ) : null}
          {staleSession ? null : <SignIn routing="hash" />}
        </div>
      </div>
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
