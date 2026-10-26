import { SignIn as ClerkSignIn } from '@clerk/react'
import { useState } from 'react'
import { SIGN_UP_PATH, WELCOME_REASON } from '../auth/links'
import { ACCOUNT_DELETED, hasAccountDeletedNotice } from '../auth/session'
import { AuthLayout } from './AuthLayout'
import { APPEARANCE } from './clerkAppearance'

/** `staleSession` withholds the form, which would redirect while Clerk still holds a session. */
export function SignIn({ staleSession }: { staleSession: boolean }) {
  // A sign-in clears the notice, so it shows here on every mount and reload until then.
  const [deleted] = useState(hasAccountDeletedNotice)
  return (
    <AuthLayout
      reason={WELCOME_REASON}
      notice={
        deleted ? (
          <p role="status" className="t-body m-0">
            {ACCOUNT_DELETED}
          </p>
        ) : null
      }
      form={
        staleSession ? null : (
          <ClerkSignIn routing="hash" signUpUrl={SIGN_UP_PATH} appearance={APPEARANCE} />
        )
      }
    />
  )
}
