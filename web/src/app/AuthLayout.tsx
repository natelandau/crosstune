import { useEffect, type ReactNode } from 'react'
import { useAnalytics } from '../usage/AnalyticsProvider'
import { SIGN_IN_HEADLINE, SIGN_IN_LINE } from '../auth/links'
import { Lockup } from '../ui/Mark'

/**
 * Two halves on a wide screen, the name and promise leading and Clerk's form trailing; one
 * column on a phone. Sign-in and sign-up share it, so moving between them keeps the page still.
 */
export function AuthLayout({
  line,
  notice,
  form,
}: {
  /** A second line under the promise. */
  line?: string
  notice?: ReactNode
  form: ReactNode
}) {
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
            {line ? <p className="t-body text-ink-2 m-0">{line}</p> : null}
          </div>
          {notice}
        </div>
        <div className="flex min-w-0 flex-1 justify-center">{form}</div>
      </div>
    </main>
  )
}
