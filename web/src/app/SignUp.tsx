import { SignUp as ClerkSignUp } from '@clerk/react'
import { SIGN_IN_PATH } from '../auth/links'
import { AuthLayout } from './AuthLayout'
import { SIGN_UP_APPEARANCE } from './clerkAppearance'

/** `staleSession` withholds the form, which would redirect while Clerk still holds a session. */
export function SignUp({ staleSession }: { staleSession: boolean }) {
  return (
    <AuthLayout
      form={
        staleSession ? null : (
          <ClerkSignUp routing="hash" signInUrl={SIGN_IN_PATH} appearance={SIGN_UP_APPEARANCE} />
        )
      }
    />
  )
}
