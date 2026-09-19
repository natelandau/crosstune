import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { WIDE_QUERY } from '../platform/frame'
import { Shell } from '../app/Shell'
import { fakeEngine } from '../test/providers'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { Screen } from './Screen'
import type { SyncStatus } from '../sync/types'

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

function renderScreenWithSync(level: 'top' | 'pushed', status: SyncStatus = 'error') {
  return renderIonic(
    <Screen title="Catalog" level={level}>
      <p>Body</p>
    </Screen>,
    { db: openTestDb(), engine: fakeEngine({ status: () => status }) },
  )
}

/** The toolbar, once Ionic has laid it out, so an absence is read from a rendered screen. */
async function settledToolbar() {
  await expect.element(page.getByText('Body')).toBeVisible()
  const toolbar = document.querySelector('ion-toolbar')!
  await vi.waitFor(() =>
    expect(toolbar.shadowRoot?.querySelector('.toolbar-container')).toBeTruthy(),
  )
  return toolbar
}

/** Where the toolbar's own title text starts, which anything in the start slot pushes along. */
async function titleLeft() {
  const toolbar = await settledToolbar()
  let left = 0
  await vi.waitFor(() => {
    const text = toolbar.querySelector('ion-title')!.shadowRoot?.querySelector('.toolbar-title')
    expect(text).toBeTruthy()
    left = text!.getBoundingClientRect().left
  })
  return left
}

describe('SyncBadge in a screen toolbar', () => {
  it('shows the state needing attention in a top-level toolbar on the phone frame', async () => {
    forceFrame(false)
    renderScreenWithSync('top')
    const badge = page.getByText('Sync failed')
    await expect.element(badge).toBeVisible()
    const toolbar = await settledToolbar()
    expect(toolbar.contains(badge.element())).toBe(true)
    expect(badge.element().getBoundingClientRect().width).toBeGreaterThan(0)
  })

  it('takes no room in the toolbar while the sync is quiet', async () => {
    forceFrame(true)
    const noBadge = renderScreenWithSync('top', 'idle')
    const bare = await titleLeft()
    noBadge.unmount()
    forceFrame(false)
    renderScreenWithSync('top', 'idle')
    const toolbar = await settledToolbar()
    expect(toolbar.querySelector('[data-testid="sync-status"]')).not.toBeNull()
    expect(toolbar.querySelector('div[slot="start"]')!.getBoundingClientRect().width).toBe(0)
    expect(await titleLeft()).toBe(bare)
  })

  it('leaves a pushed screen to its back button', async () => {
    forceFrame(false)
    renderScreenWithSync('pushed')
    const toolbar = await settledToolbar()
    expect(toolbar.querySelector('[data-testid="sync-status"]')).toBeNull()
  })

  it('leaves the badge to the sidebar on the wide frame', async () => {
    forceFrame(true)
    renderScreenWithSync('top')
    const toolbar = await settledToolbar()
    expect(toolbar.querySelector('[data-testid="sync-status"]')).toBeNull()
  })
})

describe('SyncBadge across the shell', () => {
  it('reads one state from every badge, on screen or not', async () => {
    renderIonic(<Shell initialPath="/catalog" />, {
      db: openTestDb(),
      engine: fakeEngine({ status: () => 'error' }),
    })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    const badges = Array.from(document.querySelectorAll('[data-testid="sync-status"]'))
    expect(badges.length).toBeGreaterThan(1)
    expect(badges.map((badge) => badge.getAttribute('data-status'))).toEqual(
      badges.map(() => 'error'),
    )
    // The sidebar comes first in the document and is hidden on a phone, so a client that watches
    // the first match is watching a badge nobody can see. It reports the same state regardless.
    expect(badges[0]!.closest('ion-menu')).not.toBeNull()
    expect(badges[0]!.getBoundingClientRect().width).toBe(0)
  })
})

describe('SyncBadge in the sidebar', () => {
  it('shows the state needing attention below the sidebar navigation', async () => {
    await page.viewport(1024, 768)
    try {
      renderIonic(<Shell initialPath="/catalog" />, {
        db: openTestDb(),
        engine: fakeEngine({ status: () => 'error' }),
      })
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      const badge = sidebar.getByText('Sync failed')
      await expect.element(badge).toBeVisible()
      const record = sidebar.getByText('Record').element().getBoundingClientRect()
      const box = badge.element().getBoundingClientRect()
      expect(box.top).toBeGreaterThan(record.bottom)
      const lockup = sidebar.getByText('Crosstune').element().getBoundingClientRect()
      expect(box.left).toBe(lockup.left)
    } finally {
      await page.viewport(390, 844)
    }
  })
})
