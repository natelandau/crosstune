import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_TUNE, TUNE_LIST } from '../src/features/catalog/catalogCopy'
import { PLAYER_REGION } from '../src/features/player/playerCopy'
import { NEW_RECORDING, STOP } from '../src/features/capture/recordCopy'
import { EDIT, RECORDING_NAME_LABEL } from '../src/features/recordings/recordingCopy'
import { EDIT_RECORDING_TITLE, UNFILED_HEADER } from '../src/features/recordings/recordingsCopy'
import {
  ACCOUNT,
  INSTRUMENTS,
  SYNC_AND_STORAGE,
  SYNC_NOW,
  SETTINGS_CATEGORIES,
} from '../src/features/settings/settingsCopy'
import {
  ADD_NEW_TUNE,
  NEW_TUNE_TITLE,
  STATUS_HEADER,
  TITLE_FIELD,
} from '../src/features/tune/tuneFormCopy'
import { TUNE } from '../src/features/tune/tunePageCopy'
import { MORE_ACTIONS } from '../src/ui/menuCopy'
import { RECORD_LABEL, TABS, tabLabel, TAB_BAR } from '../src/app/tabs'
import { STATUS_LABELS } from '../src/constants'
import { e2eUserEmails } from './users'
import { KEY } from '../src/ui/keyName'

export function unique(name: string): string {
  return `${name} ${Date.now().toString(36)}`
}

/** Quote a fixture name for a `RegExp`, so a title's own punctuation stays literal. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Sign in as this worker's own user. A retry keeps the worker's index, so it keeps the user. */
export async function signIn(page: Page): Promise<void> {
  const emails = e2eUserEmails()
  const emailAddress = emails[test.info().parallelIndex]
  if (!emailAddress) {
    throw new Error(`E2E_CLERK_USER_EMAILS names ${emails.length} users, too few for this worker`)
  }
  await signInAs(page, emailAddress)
}

/** Sign in as an arbitrary Clerk user, such as a throwaway one a test owns outright. */
export async function signInAs(page: Page, emailAddress: string): Promise<void> {
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signIn({ page, emailAddress })
  await page.goto('/')
  await expectSynced(page)
}

const CLERK_USERS_URL = 'https://api.clerk.com/v1/users'

function clerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY
  if (!key) throw new Error('CLERK_SECRET_KEY is not set')
  return key
}

/**
 * Create a user this suite owns outright, so a deletion test never touches the shared fixture
 * account. The `+clerk_test` address keeps it inside Clerk's test mode, and skipping the
 * password requirement is what lets a bare email address stand up a user at all.
 */
export async function createThrowawayUser(): Promise<{ id: string; emailAddress: string }> {
  const emailAddress = `e2e-delete-${crypto.randomUUID()}+clerk_test@example.com`
  const response = await fetch(CLERK_USERS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clerkSecretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: [emailAddress],
      skip_password_requirement: true,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Clerk answered ${response.status} creating a throwaway user: ${await response.text()}`,
    )
  }
  const user = (await response.json()) as { id: string }
  return { id: user.id, emailAddress }
}

/** Clean up a throwaway user regardless of how the test that created it fared. */
export async function removeClerkUser(id: string): Promise<void> {
  const response = await fetch(`${CLERK_USERS_URL}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clerkSecretKey()}` },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Clerk answered ${response.status} deleting ${id}`)
  }
}

/** The phone's bottom bar, which holds the four destinations and the Record dome. */
export const tabBar = (page: Page): Locator => page.getByRole('navigation', { name: TAB_BAR })

/** The landmark that holds a tune's page. */
export const tunePage = (page: Page): Locator => page.getByRole('main', { name: TUNE })

/**
 * A row of tunes, in the catalog or on a list's page, named for the title and then for the
 * tune's key, status, and tunings. A picker's rows are named for what a press does instead.
 */
export const tuneRow = (page: Page, title: string): Locator =>
  page
    .getByRole('grid', { name: TUNE_LIST })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(title)},`) })

/** A destination on the tab bar, by its id, such as `catalog`. */
export type Tab = (typeof TABS)[number]['tab']

/**
 * Open a destination from the tab bar. A destination reopens where it was left, and a second
 * tap on the current one returns to its root, so by default this taps again until the root is
 * showing. Pass `root: false` to stay where the destination was left.
 */
export async function openTab(
  page: Page,
  id: Tab,
  { root = true }: { root?: boolean } = {},
): Promise<void> {
  const { label, href } = TABS.find((tab) => tab.tab === id)!
  const tab = tabBar(page).getByRole('link', { name: label, exact: true })
  const path = () => new URL(page.url()).pathname
  await tab.click()
  await expect.poll(path).toMatch(new RegExp(`^${href}(/|$)`))
  if (root && path() !== href) {
    await tab.click()
    await expect.poll(path).toBe(href)
  }
}

/** Open one of the Settings categories, such as Instruments, from the Settings root. */
export async function openSetting(page: Page, name: string): Promise<void> {
  await openTab(page, 'settings')
  // A category's row is named for it, then for a summary of what it holds.
  await page
    .getByRole('grid', { name: SETTINGS_CATEGORIES })
    .getByRole('row', { name: new RegExp(`^${escapeRegExp(name)}(,|$)`) })
    .click()
  await expect(page.getByRole('main', { name, exact: true })).toBeVisible()
}

/** Open the account page from the block that leads the Settings root, named for `who`. */
export async function openAccount(page: Page, who: string): Promise<void> {
  await openTab(page, 'settings')
  await page
    .getByRole('main', { name: tabLabel('settings'), exact: true })
    .getByRole('link', { name: new RegExp(`^${escapeRegExp(who)}`) })
    .click()
  await expect(page.getByRole('main', { name: ACCOUNT, exact: true })).toBeVisible()
}

/**
 * Turn a settings switch on or off. Its input is visually hidden inside the label, so the
 * press goes to the label, as a tap does.
 */
export async function setSwitch(page: Page, toggle: Locator, on: boolean): Promise<void> {
  await expect(toggle).toBeAttached()
  if ((await toggle.isChecked()) === on) return
  await page.locator('label', { has: toggle }).click()
  await (on ? expect(toggle).toBeChecked() : expect(toggle).not.toBeChecked())
}

/**
 * Mark an instrument as played through Settings, so the tuning field and filter for it appear.
 * A fresh database has no settings row, so nothing is played until a test says so. The page is
 * left on the Instruments page.
 */
export async function playInstrument(page: Page, name: string): Promise<void> {
  await openSetting(page, INSTRUMENTS)
  await setSwitch(page, page.getByRole('switch', { name, exact: true }), true)
}

/**
 * Wait for a sync run that finished clean after `after`, so an idle indicator left over
 * from an earlier run never passes for the run the test just triggered.
 */
export async function expectSynced(page: Page, after = ''): Promise<void> {
  // A screen on its way out keeps its own badge until it has gone, so more than one can match.
  // They all read the same store, so the first reports the same state as the one on screen.
  const indicator = page.getByTestId('sync-status').first()
  await expect
    .poll(
      async () => {
        const [status, syncedAt] = await Promise.all([
          indicator.getAttribute('data-status'),
          indicator.getAttribute('data-synced-at'),
        ])
        return status === 'idle' && syncedAt !== null && syncedAt > after
      },
      { timeout: 30_000 },
    )
    .toBe(true)
}

/**
 * Wait until no sheet, menu, or dialog is on screen. One stays in the page for the length of
 * its closing animation, and while it does the page behind it is inert, so the next control
 * there is neither found nor clickable. A menu is a sheet on touch and a popover on pointer.
 */
export async function expectNoOverlay(page: Page): Promise<void> {
  await expect(page.locator('[role="dialog"], [role="alertdialog"], [role="menu"]')).toHaveCount(0)
}

/** Add a Learning tune from the catalog root, landing on its page. */
export async function addTune(page: Page, title: string, key: string): Promise<void> {
  // The screen's own Add tune control, which leads the page, not the one an empty catalog offers.
  await page
    .getByRole('main', { name: tabLabel('catalog'), exact: true })
    .getByRole('button', { name: ADD_TUNE, exact: true })
    .first()
    .click()
  const sheet = page.getByRole('dialog', { name: NEW_TUNE_TITLE })
  await sheet.getByRole('textbox', { name: TITLE_FIELD, exact: true }).fill(title)
  await sheet
    .getByRole('radiogroup', { name: STATUS_HEADER })
    .getByRole('radio', { name: STATUS_LABELS.learning, exact: true })
    .click()
  await sheet
    .getByRole('listbox', { name: KEY })
    .getByRole('option', { name: key, exact: true })
    .click()
  await sheet.getByRole('button', { name: ADD_NEW_TUNE, exact: true }).click()
  await expect(tunePage(page).getByRole('heading', { name: title, level: 1 })).toBeVisible()
}

// The press-and-hold rule of LONG_PRESS_MS in src/ui/RowSwipe.tsx, with room for a slow frame.
// Nothing on screen marks the moment a hold counts, so the hold is a gesture of this length.
const HOLD_MS = 700

interface Point {
  x: number
  y: number
}

/**
 * Play a touch gesture: a press at `from`, held for `holdMs`, then moved to `to` and lifted.
 * A row's swipe, hold, and drag answer only a touch pointer, and Playwright's own touchscreen
 * only taps, so the gesture goes through the DevTools protocol, which the page sees as touch.
 */
async function touchGesture(
  page: Page,
  from: Point,
  { holdMs = 0, to = from, steps = 12 }: { holdMs?: number; to?: Point; steps?: number } = {},
): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    if (holdMs > 0) await page.waitForTimeout(holdMs)
    if (to.x !== from.x || to.y !== from.y) {
      for (let step = 1; step <= steps; step += 1) {
        const x = from.x + ((to.x - from.x) * step) / steps
        const y = from.y + ((to.y - from.y) * step) / steps
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
      }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

/** Measure a row once it has stopped moving, for a gesture aimed at that one measurement. */
async function settledCenter(row: Locator): Promise<Point> {
  await row.scrollIntoViewIfNeeded()
  // A row still arriving, behind a filter or a dismissed sheet, would take the press where it
  // no longer is.
  await expectSettled(row)
  const box = await row.boundingBox()
  if (!box) throw new Error(`${row} is not visible`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Whether a row's swipe actions are open, as the row itself reports it. */
export const swipeState = (row: Locator): Locator => row.locator('[data-swipe]')

/** Swipe a row left with a finger, far and fast enough to open its actions. */
export async function swipeLeft(page: Page, row: Locator): Promise<void> {
  // The page behind an overlay is inert, so a gesture on it would land on the overlay instead.
  await expectNoOverlay(page)
  await expect(async () => {
    const from = await settledCenter(row)
    await touchGesture(page, from, { to: { x: from.x - 200, y: from.y } })
    await expect(swipeState(row)).toHaveAttribute('data-swipe', 'open', { timeout: 1000 })
  }).toPass({ timeout: 20_000 })
}

/** Press and hold a row with a finger, then lift, which opens the row's menu. */
export async function openRowMenu(page: Page, row: Locator, name: string): Promise<Locator> {
  await expectNoOverlay(page)
  await touchGesture(page, await settledCenter(row), { holdMs: HOLD_MS })
  const menu = page.getByRole('menu', { name, exact: true })
  await expect(menu).toBeVisible()
  return menu
}

/** Hold a row with a finger, then drag it until it lies just past `target`, and lift. */
export async function dragRow(page: Page, row: Locator, target: Locator): Promise<void> {
  await expectNoOverlay(page)
  const from = await settledCenter(row)
  const box = await target.boundingBox()
  if (!box) throw new Error(`${target} is not visible`)
  await touchGesture(page, from, {
    holdMs: HOLD_MS,
    to: { x: from.x, y: box.y + box.height * 0.75 },
    steps: 20,
  })
}

/**
 * Wait until an element stops moving. A row keeps animating into place after the finger
 * lifts, and a tap that lands during that drops, as a person's would not.
 */
export async function expectSettled(target: Locator): Promise<void> {
  let previous: string | undefined
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await target.boundingBox())
        const settled = box === previous
        previous = box
        return settled
      },
      { intervals: [50] },
    )
    .toBe(true)
}

/** The label a new recording takes from the time it was made. */
export const DEFAULT_LABEL = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/

/** Record from the dome for at least `seconds`, landing on Recordings with the new row unfiled. */
export async function recordUnfiled(page: Page, seconds: number): Promise<Locator> {
  await tabBar(page).getByRole('button', { name: RECORD_LABEL }).click()
  const sheet = page.getByRole('dialog', { name: NEW_RECORDING })
  const timer = sheet.getByRole('timer')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(new RegExp(`^0:0[${seconds}-9]$`), { timeout: 15_000 })
  await sheet.getByRole('button', { name: STOP, exact: true }).click()
  await expect(page).toHaveURL(/\/recordings$/)
  const row = page.getByRole('grid', { name: UNFILED_HEADER, exact: true }).getByRole('row').first()
  await expect(row).toContainText(DEFAULT_LABEL)
  return row
}

/** Nudge the sync loop from the Sync and storage page. The page is left there. */
async function syncNow(page: Page): Promise<void> {
  await openSetting(page, SYNC_AND_STORAGE)
  await page.getByRole('button', { name: SYNC_NOW, exact: true }).click()
}

/**
 * Wait until `row` settles out of the upload/transcode pipeline, nudging the sync loop from
 * Settings along the way in case it is between passes or backing off. `restore` returns to
 * wherever `row` is shown after that nudge; the Recordings tab by default.
 */
export async function waitForReady(
  page: Page,
  row: Locator,
  { timeout = 60_000, restore }: { timeout?: number; restore?: () => Promise<void> } = {},
): Promise<void> {
  const busy = /Waiting to upload|Uploading|Processing/
  await expect
    .poll(
      async () => {
        const text = (await row.textContent()) ?? ''
        if (busy.test(text)) {
          await syncNow(page)
          if (restore) await restore()
          else await openTab(page, 'recordings')
        }
        return row.textContent()
      },
      { timeout, intervals: [3_000] },
    )
    .not.toMatch(busy)
}

/** The practice overlay, which names itself for the recording, as the trim view does for trim. */
export const practiceOverlay = (page: Page): Locator =>
  page.locator('[data-practice]').getByRole('dialog')

/**
 * Play a recording row the way a musician does: a press plays it, and on a device that does not
 * hold its audio the first press fetches it. The press lands on the row's `label`, clear of the
 * tune line a filed row carries under it, which is a control of its own.
 */
export async function playRecording(
  row: Locator,
  label: string | RegExp = DEFAULT_LABEL,
): Promise<void> {
  const page = row.page()
  const download = row.and(page.getByRole('row', { name: /^Download / }))
  const play = row.and(page.getByRole('row', { name: /^Play / }))
  await expect(play.or(download)).toBeVisible({ timeout: 30_000 })
  if (await download.isVisible()) await download.getByText(label).first().click()
  await play.getByText(label).first().click({ timeout: 30_000 })
}

/** Open practice on `row`: play it, then open practice from the now-playing bar's title. */
export async function openPractice(
  page: Page,
  row: Locator,
  label: string | RegExp = DEFAULT_LABEL,
): Promise<Locator> {
  await playRecording(row, label)
  await page
    .getByRole('region', { name: PLAYER_REGION, exact: true })
    .getByRole('button', { name: /^Open / })
    .click()
  const practice = practiceOverlay(page)
  await expect(practice).toBeVisible()
  return practice
}

/**
 * Rename the recording open on `practice` through Edit in its menu. A recording's default label
 * is only minute-precise, so a second device can find the row by a `unique()` name where two
 * recordings made in the same minute would share a label.
 */
export async function renameRecording(page: Page, practice: Locator, name: string): Promise<void> {
  await practice.getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .getByRole('menu', { name: MORE_ACTIONS })
    .getByRole('menuitem', { name: EDIT, exact: true })
    .click()
  const sheet = page.getByRole('dialog', { name: EDIT_RECORDING_TITLE })
  const field = sheet.getByRole('textbox', { name: RECORDING_NAME_LABEL, exact: true })
  await field.fill(name)
  await field.press('Enter')
  await expect(sheet).toHaveCount(0)
  await expect(practice.getByRole('heading', { name, exact: true })).toBeVisible()
}

/** Nudge the transfer loop from Settings, then return to the Recordings root. */
export async function nudgeSync(page: Page): Promise<void> {
  await syncNow(page)
  await openTab(page, 'recordings')
}

export interface StubbedResult {
  url: string
  provider: string
  provider_ref: string | null
  title: string
  subtitle: string | null
  artwork_url: string | null
}

export interface StubbedGroup {
  provider: string
  status: 'results' | 'search_only' | 'unavailable'
  results: StubbedResult[]
  search_url: string
}

/**
 * Answer every music search with the `groups` for the services it asks for, so no run reaches
 * a real service. Returns the request URLs seen, in order, for a test to assert on.
 */
export async function stubSearch(page: Page, groups: StubbedGroup[]): Promise<URL[]> {
  const seen: URL[] = []
  await page.route('**/v1/links/search**', async (route) => {
    const url = new URL(route.request().url())
    seen.push(url)
    const asked = requestedProviders(url)
    await route.fulfill({
      json: { groups: groups.filter((group) => asked.includes(group.provider)) },
    })
  })
  return seen
}

/** The services a search request asked for, one repeated `providers` parameter each. */
export function requestedProviders(url: URL): string[] {
  return url.searchParams.getAll('providers')
}
