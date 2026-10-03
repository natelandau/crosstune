import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { WIDE_QUERY } from '../platform/frame'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { fakeEngine } from '../test/providers'
import type { SyncStatus } from '../sync/types'
import { Screen } from './Screen'

// Longer than the toolbar can show, so the title is laid out to its box edges rather than
// sitting comfortably in the middle of the bar.
const LONG_TITLE = 'Recordings from the Tuesday jam'

const original = window.matchMedia

afterEach(() => {
  window.matchMedia = original
})

function forceFrame(wide: boolean) {
  window.matchMedia = (query: string) =>
    query === WIDE_QUERY
      ? ({
          matches: wide,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : original.call(window, query)
}

async function renderTop(status: SyncStatus) {
  const view = renderIonic(
    <Screen title={LONG_TITLE} level="top">
      <p>Body</p>
    </Screen>,
    { db: openTestDb(), engine: fakeEngine({ status: () => status }) },
  )
  await expect.element(page.getByText('Body')).toBeVisible()
  const toolbar = document.querySelector('ion-header:not([collapse]) ion-toolbar')!
  let text!: Element
  await vi.waitFor(() => {
    const node = toolbar.querySelector('ion-title')!.shadowRoot?.querySelector('.toolbar-title')
    expect(node).toBeTruthy()
    text = node!
  })
  return {
    view,
    bar: () => toolbar.getBoundingClientRect(),
    title: () => text.getBoundingClientRect(),
    badge: () =>
      toolbar.querySelector('[data-testid="sync-status"]')?.getBoundingClientRect() ?? null,
  }
}

/** The widest badge, with a title too long to fit, must stay off the title and off center. */
async function expectTitleClearOfWidestBadge() {
  forceFrame(false)
  const { bar, title, badge } = await renderTop('unauthorized')
  await expect.poll(() => badge()!.width).toBeGreaterThan(0)
  await expect.poll(() => title().left - (badge()!.right + 8)).toBeGreaterThanOrEqual(0)
  const offCenter = () => {
    const [t, b] = [title(), bar()]
    return (t.left + t.right) / 2 - (b.left + b.right) / 2
  }
  await expect.poll(() => Math.abs(offCenter())).toBeLessThanOrEqual(1)
}

// On iOS the title is positioned across the whole toolbar rather than laid out beside what
// shares the bar, so anything in the start slot sits over it.
describe('SyncBadge on iOS', () => {
  it('leaves a long title room beside the widest badge, still centered', async () => {
    await expectTitleClearOfWidestBadge()
  })

  // The narrowest phone the client supports. A title this cramped is ellipsized, which is what
  // a centered iOS title flanked by a bar item does, but it must never run under the badge.
  it('keeps the title off the badge on the narrowest phone', async () => {
    await page.viewport(360, 780)
    try {
      await expectTitleClearOfWidestBadge()
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('gives the title the whole bar back while the sync is quiet', async () => {
    forceFrame(true)
    const bare = await renderTop('idle')
    await expect.poll(bare.badge).toBeNull()
    const bareTitle = bare.title()
    bare.view.unmount()
    forceFrame(false)
    const quiet = await renderTop('idle')
    await expect.poll(() => quiet.badge()!.width).toBe(0)
    await expect.poll(() => quiet.title().left).toBe(bareTitle.left)
    await expect.poll(() => quiet.title().width).toBe(bareTitle.width)
  })
})
