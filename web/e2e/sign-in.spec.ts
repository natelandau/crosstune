import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { SIGN_IN_PATH, SIGN_UP_LINE, SIGN_UP_PATH } from '../src/auth/links'

test.use({ viewport: { width: 375, height: 667 } })

test('shows the email field without scrolling on a small phone when signed out', async ({
  page,
}) => {
  await setupClerkTestingToken({ page })
  await page.goto(SIGN_IN_PATH)
  const field = page.getByLabel('Email address')
  await expect(field).toBeVisible({ timeout: 30_000 })
  // The app's router only exists once someone is signed in, so nothing rewrites the address.
  expect(new URL(page.url()).pathname).toBe(SIGN_IN_PATH)
  await expect
    .poll(async () => {
      const box = await field.boundingBox()
      return box ? box.y + box.height : Infinity
    })
    .toBeLessThanOrEqual(667)
})

/** The link's path on the page's origin, without the query and trailing slash Clerk may add. */
async function sameOriginPath(page: Page, link: Locator) {
  const href = new URL((await link.getAttribute('href')) ?? '', page.url())
  expect(href.origin).toBe(new URL(page.url()).origin)
  return href.pathname.replace(/(.)\/$/, '$1')
}

test('points the sign-in footer at the sign-up screen', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await page.goto(SIGN_IN_PATH)
  const link = page.getByRole('link', { name: 'Sign up' })
  await expect(link).toBeVisible({ timeout: 30_000 })
  expect(await sameOriginPath(page, link)).toBe(SIGN_UP_PATH)
  await link.click()
  await expect(page.getByText(SIGN_UP_LINE)).toBeVisible({ timeout: 30_000 })
})

test('shows the sign-up form and points its footer at sign-in', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await page.goto(SIGN_UP_PATH)
  await expect(page.getByText(SIGN_UP_LINE)).toBeVisible({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe(SIGN_UP_PATH)
  await expect(page.getByLabel('Email address')).toBeVisible({ timeout: 30_000 })
  const link = page.getByRole('link', { name: 'Sign in' })
  await expect(link).toBeVisible()
  expect(await sameOriginPath(page, link)).toBe(SIGN_IN_PATH)
})
