import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

export function unique(name: string): string {
  return `${name} ${Date.now().toString(36)}`
}

/** Quote a fixture name for a `RegExp`, so a title's own punctuation stays literal. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A fresh database has no settings row for the test user, so the first sign-in of a run
// meets the first-run prompt; once it is answered the row persists for every later test.
let instrumentsAnswered = false

export async function signIn(page: Page): Promise<void> {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL
  if (!emailAddress) throw new Error('E2E_CLERK_USER_EMAIL is not set')
  await setupClerkTestingToken({ page })
  await page.goto('/')
  await clerk.signIn({ page, emailAddress })
  await page.goto('/')
  await expectSynced(page)
  if (!instrumentsAnswered) {
    await answerInstrumentsPrompt(page)
    instrumentsAnswered = true
  }
}

/** Answer the first-run instruments prompt if it opens, and carry on if it does not. */
async function answerInstrumentsPrompt(page: Page): Promise<void> {
  const prompt = page.getByRole('dialog', { name: 'Which instruments do you play?' })
  const opened = await prompt
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false)
  if (!opened) return
  // The sheet's own controls are never scoped to its dialog: the dialog resolves to a wrapper
  // inside ion-modal's shadow root, and the sheet's content is slotted light DOM rather than a
  // descendant of it. The page behind leaves the accessibility tree while the sheet is up, so
  // each name is unique without the scope.
  const violin = page.getByRole('checkbox', { name: 'Violin' })
  // `check()` reads the state back the instant its click returns, and ion-checkbox mirrors the
  // new state to aria-checked a render later, so the click and the assertion are separate steps.
  await violin.click()
  await expect(violin).toBeChecked()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(prompt).toBeHidden()
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

export async function addSong(page: Page, title: string, key: string): Promise<void> {
  // The screen's own Add song control, not the one the empty state offers.
  await page.getByRole('banner').getByRole('button', { name: 'Add song' }).click()
  // The sheet's fields are never scoped to its dialog: the dialog resolves to a wrapper inside
  // ion-modal's shadow root, and the form is slotted light DOM rather than a descendant of it.
  const titleField = page.getByRole('textbox', { name: 'Title', exact: true })
  // A sheet is visible from the first frame of the animation that raises it, while its lower
  // rows are still below the fold, and a forced click never waits for a row to arrive.
  await expectSettled(titleField)
  await titleField.fill(title)
  // A segment button is covered by the segment's own indicator, which an actionability check
  // reads as an obstruction.
  const learning = page.getByRole('tab', { name: 'Learning' })
  await expectSettled(learning)
  await learning.click({ force: true })
  // The select names itself by its field and its current value, but a click at its own button
  // lands on the select's control instead, so the row around it is what opens the choices. They
  // open in an overlay: an action sheet on touch, a popover on a mouse, so picking by text
  // serves both.
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Key,/ }) })
    .click()
  const choices = page.locator('ion-action-sheet, ion-popover').last()
  // Counting the choices is a one-shot read, so it has to come after the overlay is up or an
  // unopened overlay reads as a key with no suggestion.
  await expect(choices).toBeVisible()
  const suggested = choices.getByText(key, { exact: true })
  // A suggested key is one tap; any other key goes through Other and its text field.
  if ((await suggested.count()) > 0) {
    await suggested.click()
  } else {
    await choices.getByText('Other…', { exact: true }).click()
    await page.getByRole('textbox', { name: 'Other key' }).fill(key)
  }
  await expectNoOverlay(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  // The song page the client opens on a save. Its own heading leads the page; the catalog row
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
