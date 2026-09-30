import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test } from '@playwright/test'
import { WAITLIST_URL } from '../src/auth/links'

test.use({ viewport: { width: 375, height: 667 } })

test('shows the email field without scrolling on a small phone when signed out', async ({
  page,
}) => {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  const field = page.getByLabel('Email address')
  await expect(field).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(async () => {
      const box = await field.boundingBox()
      return box ? box.y + box.height : Infinity
    })
    .toBeLessThanOrEqual(667)
})

test('points the Clerk card footer at the waitlist when signed out', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  const link = page.getByRole('link', { name: 'Join waitlist' })
  await expect(link).toBeVisible({ timeout: 30_000 })
  // Clerk appends its dev-browser token as a query and may add a trailing slash to the path.
  const href = new URL((await link.getAttribute('href')) ?? '')
  const expected = new URL(WAITLIST_URL)
  expect(href.origin).toBe(expected.origin)
  expect(href.pathname.replace(/\/$/, '')).toBe(expected.pathname)
})
