import { setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { SIGN_IN_PATH, SIGN_UP_PATH, SIGN_UP_TITLE, WELCOME_REASON } from '../src/auth/links'

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
  await expect(page.getByRole('heading', { name: SIGN_UP_TITLE })).toBeVisible({ timeout: 30_000 })
  expect(new URL(page.url()).pathname).toBe(SIGN_UP_PATH)
})

test('shows the sign-up form and points its footer at sign-in', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await page.goto(SIGN_UP_PATH)
  await expect(page.getByText(WELCOME_REASON)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('heading', { name: SIGN_UP_TITLE })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(SIGN_UP_PATH)
  const email = page.getByLabel('Email address')
  await expect(email).toBeVisible({ timeout: 30_000 })
  for (const name of ['Google', 'Apple']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const handle = await button.elementHandle()
    try {
      // 4 is DOCUMENT_POSITION_FOLLOWING: the button comes after the email field.
      const position = await email.evaluate(
        (field, el) => field.compareDocumentPosition(el),
        handle,
      )
      expect(position & 4).toBe(4)
    } finally {
      await handle?.dispose()
    }
  }
  const link = page.getByRole('link', { name: 'Sign in' })
  await expect(link).toBeVisible()
  expect(await sameOriginPath(page, link)).toBe(SIGN_IN_PATH)
})
