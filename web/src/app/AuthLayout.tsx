import { useEffect, useId, useState, type ReactNode } from 'react'
import { useAnalytics } from '../usage/AnalyticsProvider'
import { WHY_ACCOUNT_LINK } from '../auth/links'
import { Button } from '../ui/Button'
import { Lockup } from '../ui/Mark'
import { AccountReasonSheet } from './welcome/AccountReasonSheet'
import { WelcomeCarousel } from './welcome/WelcomeCarousel'

/**
 * Two halves on a wide screen, the name and the carousel leading and the account trailing; one
 * column on a phone. Sign-in and sign-up share it, so moving between them keeps the page still.
 */
export function AuthLayout({
  notice,
  form,
  reason,
}: {
  notice?: ReactNode
  form: ReactNode
  /** Shown under the form; sign-up omits it because Clerk's subtitle carries it. */
  reason?: string
}) {
  const analytics = useAnalytics()
  useEffect(() => analytics.screen('welcome'), [analytics])
  const [whyOpen, setWhyOpen] = useState(false)
  const lockupId = useId()
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="welcome:flex-row welcome:items-center welcome:gap-16 flex w-full max-w-5xl flex-col gap-8">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-6">
          <span id={lockupId}>
            <Lockup className="t-heading" />
          </span>
          <WelcomeCarousel labelledBy={lockupId} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-4">
          {notice}
          {form}
          {reason ? <p className="t-body text-ink-2 max-w-auth m-0">{reason}</p> : null}
          <Button
            label={WHY_ACCOUNT_LINK}
            onPress={() => {
              analytics.send('account_reason_opened', {})
              setWhyOpen(true)
            }}
          />
        </div>
      </div>
      <AccountReasonSheet isOpen={whyOpen} onOpenChange={setWhyOpen} />
    </main>
  )
}
