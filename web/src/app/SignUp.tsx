import { SignUp as ClerkSignUp } from '@clerk/react'
import { SIGN_IN_PATH, SIGN_UP_LINE } from '../auth/links'
import { AuthLayout } from './AuthLayout'
import { APPEARANCE } from './clerkAppearance'

/** `staleSession` withholds the form, which would redirect while Clerk still holds a session. */
export function SignUp({ staleSession }: { staleSession: boolean }) {
  return (
    <AuthLayout
      line={SIGN_UP_LINE}
      form={
        staleSession ? null : (
          <ClerkSignUp routing="hash" signInUrl={SIGN_IN_PATH} appearance={APPEARANCE} />
        )
      }
    />
  )
}
