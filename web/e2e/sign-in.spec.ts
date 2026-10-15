import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test } from '@playwright/test'

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

test('offers sign-up from the sign-in card when signed out', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible({ timeout: 30_000 })
})
