import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { RECORDING_NAME_LABEL, RENAME } from '../src/features/recordings/recordingCopy'
import { MORE_KEYS } from '../src/features/tune/KeyChooser'
import { MORE_ACTIONS } from '../src/ui/Menu'
import { e2eUserEmails } from './users'

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
  const emailAddress = `e2e-delete-${Date.now()}+clerk_test@example.com`
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
    throw new Error(`Clerk answered ${response.status} creating a throwaway user`)
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

/**
 * Mark an instrument as played through Settings, so the tuning field and filter for it appear.
 * A fresh database has no settings row, so nothing is played until a test says so. The page is
 * left on the Settings tab.
 */
export async function playInstrument(page: Page, name: string): Promise<void> {
  await openTab(page, 'Settings')
  await page.getByRole('button', { name: /^Instruments/ }).click()
  // The sheet's controls are never scoped to its dialog: the dialog resolves to a wrapper inside
  // ion-modal's shadow root, and the sheet's content is slotted light DOM beside it. The page
  // behind leaves the accessibility tree while the sheet is up, so the name is unique without
  // the scope.
  const box = page.getByRole('checkbox', { name })
  await expect(box).toBeVisible()
  if (!(await box.isChecked())) {
    // `check()` reads the state back the instant its click returns, and ion-checkbox mirrors
    // the new state to aria-checked a render later, so the click and the assertion are separate.
    await box.click()
    await expect(box).toBeChecked()
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expectNoOverlay(page)
}

/**
 * The tab bar is how the client moves between screens. A pushed screen stays in the
 * accessibility tree for the length of the transition, and its toolbar carries the same control
 * names as the one arriving, so nothing is touched until only one of them is left.
 */
export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click()
  await expect(page.getByRole('banner')).toHaveCount(1)
}

/**
 * Wait for a sync run that finished clean after `after`, so an idle indicator left over
 * from an earlier run never passes for the run the test just triggered.
 */
export async function expectSynced(page: Page, after = ''): Promise<void> {
  // The sidebar holds a badge on every frame and every top-level screen holds one, so more than
  // one matches, and on a phone the sidebar's comes first and is hidden. They all read the same
  // store, so the first reports the same state as the one on screen.
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
 * Wait until no action sheet or popover is on screen. Ionic leaves one in the DOM for the length
 * of its dismiss animation, and while it is there the page behind it is out of the accessibility
 * tree and behind a backdrop, so the next control on the page is neither found nor clickable.
 */
export async function expectNoOverlay(page: Page): Promise<void> {
  await expect(page.locator('ion-action-sheet, ion-popover')).toHaveCount(0)
}

export async function addTune(page: Page, title: string, key: string): Promise<void> {
  // The screen's own Add tune control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add tune' }).click()
  // The sheet's fields are never scoped to its dialog: the dialog resolves to a wrapper inside
  // ion-modal's shadow root, and the form is slotted light DOM rather than a descendant of it.
  const titleField = page.getByRole('textbox', { name: 'Title', exact: true })
  // A sheet is visible from the first frame of the animation that raises it, while its lower
  // rows are still below the fold, and a forced click never waits for a row to arrive.
  await expectSettled(titleField)
  await titleField.fill(title)
  // Status and key are rows of capsules, and the catalog behind the sheet carries capsules with
  // the same words, so each click is scoped to the group that owns it. The sheet's own content
  // is slotted light DOM under ion-modal, which is why the element scopes it and the dialog
  // role cannot.
  const sheet = page.locator('ion-modal.show-modal')
  const learning = sheet
    .getByRole('group', { name: 'Status' })
    .getByRole('button', { name: 'Learning', exact: true })
  await expectSettled(learning)
  await learning.click()
  const keys = sheet.getByRole('group', { name: 'Key' })
  const pill = keys.getByRole('button', { name: key, exact: true })
  // A key on the grid is one tap. Any other key sits behind More keys…, which opens an action
  // sheet on touch and a popover on a mouse, so picking by text serves both.
  if ((await pill.count()) > 0) {
    await expectSettled(pill)
    await pill.click()
  } else {
    await keys.getByRole('button', { name: MORE_KEYS, exact: true }).click()
    const choices = page.locator('ion-action-sheet, ion-popover').last()
    await expect(choices).toBeVisible()
    await choices.getByText(key, { exact: true }).click()
  }
  await expectNoOverlay(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  // The tune page the client opens on a save. Its own heading leads the page; the catalog row
  // behind it carries the same title as a second-level heading, so the level tells them apart.
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
}

/** Drag a row left with the mouse, far and fast enough to open its swipe actions. */
export async function swipeLeft(page: Page, target: Locator): Promise<void> {
  // Raw mouse input skips Playwright's actionability checks, so a row under the fixed dock, or
  // under an overlay still on its way out, would take the press on that instead.
  await expect(page.locator('ion-modal.show-modal, ion-action-sheet, ion-popover')).toHaveCount(0)
  // Ionic carries the open side on the row that holds the target, and that row is the only one
  // this drag proves anything about: another row left open elsewhere would otherwise pass for
  // it. The walk starts at the target because a caller's locator is written against the screen,
  // not against the row, and climbs out of the shadow root a row's own control sits in.
  const rowIsOpen = () =>
    target.evaluate((element) => {
      let node: Element | null = element
      while (node) {
        const row = node.closest('ion-item-sliding')
        if (row) return row.classList.contains('item-sliding-active-options-end')
        const root = node.getRootNode()
        node = root instanceof ShadowRoot ? root.host : null
      }
      return false
    })
  await expect(async () => {
    await target.scrollIntoViewIfNeeded()
    // The drag is aimed at one measurement, so a row that is still arriving, behind a filter or
    // a dismissed sheet, would take the press where it no longer is.
    await expectSettled(target)
    const box = await target.boundingBox()
    if (!box) throw new Error('swipe target is not visible')
    const y = box.y + box.height / 2
    // The drag starts at the middle of the row, not its trailing edge: a row can carry a reorder
    // grip there, and a press that lands on one starts that gesture instead of the swipe.
    const startX = box.x + box.width / 2
    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(startX - 200, y, { steps: 12 })
    await page.mouse.up()
    await expectSettled(target)
    await expect
      .poll(rowIsOpen, { timeout: 1000, message: `swipe left on ${target} left the row shut` })
      .toBe(true)
  }).toPass({ timeout: 20_000 })
}

// The client swallows the click a long press leaves behind, so the row under the finger does not
// also open, and nothing on screen marks the end of that guard. This is CLICK_GUARD_MS in
// src/ui/longPress.ts with room for a slow frame, and has to stay the larger of the two: a
// release that reported done any sooner would hand back a page still dropping taps.
const CLICK_GUARD_MS = 150

/** Press and hold a row with the mouse. The caller checks the result while the button is down, then releases. */
export async function longPress(
  page: Page,
  target: Locator,
): Promise<{ release: () => Promise<void> }> {
  await target.scrollIntoViewIfNeeded()
  // The press is aimed at one measurement, so a row that is still arriving, behind a filter or a
  // dismissed sheet, would take it where it no longer is.
  await expectSettled(target)
  const box = await target.boundingBox()
  if (!box) throw new Error('long-press target is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  return {
    release: async () => {
      await page.mouse.up()
      await page.waitForTimeout(CLICK_GUARD_MS)
    },
  }
}

/**
 * Wait until a dragged element stops moving. A row keeps animating into place after the pointer
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

/** Record from the dock for at least `seconds`, landing on the recordings tab with the new row unfiled. */
export async function recordUnfiled(page: Page, seconds: number): Promise<Locator> {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Start a new recording' })
    .click()
  const timer = page.getByRole('timer')
  await expect(timer).toBeVisible()
  await expect(timer).toHaveText(new RegExp(`^0:0[${seconds}-9]$`), { timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page).toHaveURL(/\/recordings$/)
  const row = page.getByRole('list', { name: 'Unfiled' }).getByRole('listitem').first()
  await expect(row).toContainText(DEFAULT_LABEL)
  return row
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
          await page.getByRole('tab', { name: 'Settings' }).click()
          await page.getByRole('button', { name: 'Sync now' }).click()
          if (restore) await restore()
          else await page.getByRole('tab', { name: 'Recordings' }).click()
        }
        return row.textContent()
      },
      { timeout, intervals: [3_000] },
    )
    .not.toMatch(busy)
}

/**
 * Rename the recording open on `screen` from its menu. A recording's default label is only
 * minute-precise, so a second device can find the row by a `unique()` name where two recordings
 * made in the same minute would share a label.
 */
export async function renameRecording(page: Page, screen: Locator, name: string): Promise<void> {
  await screen.getByRole('button', { name: MORE_ACTIONS, exact: true }).click()
  await page
    .locator('ion-action-sheet, ion-popover')
    .last()
    .getByRole('button', { name: RENAME, exact: true })
    .click()
  await expectNoOverlay(page)
  const field = page.getByRole('textbox', { name: RECORDING_NAME_LABEL, exact: true })
  await expectSettled(field)
  await field.fill(name)
  await field.press('Enter')
  // The rename sheet is a second ion-modal over the recording screen, so `screen` matches both
  // until it has gone.
  await expect(page.locator('ion-modal.show-modal')).toHaveCount(1)
}

/** Nudge the transfer loop from Settings, then return to the recordings list it left. */
export async function nudgeSync(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sync now' }).click()
  await page.getByRole('tab', { name: 'Recordings' }).click()
}
