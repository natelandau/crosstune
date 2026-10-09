import { SignIn as ClerkSignIn } from '@clerk/react'
import { useEffect, useState } from 'react'
import { useAnalytics } from '../analytics/AnalyticsProvider'
import { SIGN_IN_HEADLINE, SIGN_IN_LINE } from '../auth/links'
import { ACCOUNT_DELETED, hasAccountDeletedNotice } from '../auth/session'
import { Lockup } from '../ui/Mark'

// Clerk renders these inside its own DOM, so the app's tokens reach it as CSS variables, which
// keeps the form in step with the color scheme.
const APPEARANCE = {
  variables: {
    colorPrimary: 'var(--slate)',
    colorPrimaryForeground: 'var(--on-slate)',
    colorForeground: 'var(--ink)',
    colorMutedForeground: 'var(--ink-2)',
    colorMuted: 'var(--fill)',
    colorBackground: 'var(--ground)',
    colorInput: 'var(--ground)',
    colorInputForeground: 'var(--ink)',
    colorBorder: 'var(--hairline)',
    colorDanger: 'var(--danger)',
    colorNeutral: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-row)',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: {
      width: '100%',
      maxWidth: '25rem',
      boxShadow: 'none',
      borderRadius: 'var(--radius-surface)',
      border: '1px solid var(--hairline)',
    },
    card: { boxShadow: 'none', borderRadius: 'var(--radius-surface)' },
  },
}

/**
 * Two halves on a wide screen, the name and promise leading and Clerk's form trailing; one
 * column on a phone. `staleSession` withholds the form, which would redirect while Clerk still
 * holds a session.
 */
export function SignIn({ staleSession }: { staleSession: boolean }) {
  // A sign-in clears the notice, so it shows here on every mount and reload until then.
  const [deleted] = useState(hasAccountDeletedNotice)
  const analytics = useAnalytics()
  useEffect(() => analytics.screen('welcome'), [analytics])
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-5xl flex-col gap-8 min-[60rem]:flex-row min-[60rem]:items-center min-[60rem]:gap-16">
        <div className="flex flex-1 flex-col items-start gap-6">
          <Lockup className="t-heading" />
          <div className="flex flex-col gap-2">
            <h1 className="t-screen-title m-0">{SIGN_IN_HEADLINE}</h1>
            <p className="t-body text-ink-2 m-0">{SIGN_IN_LINE}</p>
          </div>
          {deleted ? (
            <p role="status" className="t-body m-0">
              {ACCOUNT_DELETED}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          {staleSession ? null : <ClerkSignIn routing="hash" appearance={APPEARANCE} />}
        </div>
      </div>
    </main>
  )
}
