import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import {
  WHY_ACCOUNT_BODY,
  WHY_ACCOUNT_DONE,
  WHY_ACCOUNT_LINK,
  WHY_ACCOUNT_TITLE,
} from '../../auth/links'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { renderWithProviders } from '../../test/render'
import { AuthLayout } from '../AuthLayout'

describe('AccountReasonSheet', () => {
  it.each(['pointer', 'touch'] as const)(
    'the why link opens the sheet and reports it (%s)',
    async (density) => {
      const analytics = recordingAnalytics()
      renderWithProviders(
        <AnalyticsProvider client={analytics}>
          <AuthLayout form={<p>form</p>} />
        </AnalyticsProvider>,
        { density },
      )
      await page.getByRole('button', { name: WHY_ACCOUNT_LINK }).click()
      const sheet = page.getByRole('dialog', { name: WHY_ACCOUNT_TITLE })
      await expect.element(sheet).toBeVisible()
      for (const paragraph of WHY_ACCOUNT_BODY) {
        await expect.element(sheet.getByText(paragraph)).toBeVisible()
      }
      await expect
        .poll(() => analytics.sends().filter((send) => send.name === 'account_reason_opened'))
        .toHaveLength(1)
      await sheet.getByRole('button', { name: WHY_ACCOUNT_DONE }).click()
      await expect.element(sheet).not.toBeInTheDocument()
      expect(
        analytics.sends().filter((send) => send.name === 'account_reason_opened'),
      ).toHaveLength(1)
    },
  )
})
