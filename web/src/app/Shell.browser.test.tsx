import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createList } from '../commands/lists'
import { createTune } from '../commands/tunes'
import { NEW_RECORDING } from '../features/recording/RecordModal'
import { NO_RECORDINGS_TITLE } from '../features/recordings/RecordingsPage'
import { openTestDb } from '../test/db'
import { FakeRecorder, stubMediaGlobals } from '../test/fakeMedia'
import { renderIonic } from '../test/ionic'
import { Shell } from './Shell'
import { RECORD_LABEL } from './tabs'

// The settings screen reads the account from Clerk, which only answers under a ClerkProvider.
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: async () => {} }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'nate@example.com' } } }),
}))

// A size, weight, or tracking utility. A type role carries all three, so a screen that sets one
// of its own has stepped outside the roles. `text-xl` carries no digit; `text-2xl` and up do.
const AD_HOC_TYPE = /\btext-(xs|sm|base|lg|\d?xl)\b|\bfont-\w+\b|\btracking-\w+\b/

let restore: (() => void) | null = null

/**
 * A microphone that is asked for and never answers, so the record screen stays on its starting
 * phase. Without it these tests reach the machine's real devices, where a refusal that lands
 * fast enough swaps the footer's Cancel for Done under the click.
 */
function fakeSilentMedia() {
  const owned = (['mediaDevices', 'storage'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
  )
  const { getUserMedia } = stubMediaGlobals()
  getUserMedia.mockImplementation(() => new Promise(() => {}))
  restore = () => {
    for (const [key, descriptor] of owned) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor)
      else Reflect.deleteProperty(navigator, key)
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  restore?.()
  restore = null
})

// The outlet keeps pages it has left in the DOM, hidden, so every page assertion checks
// visibility rather than presence. Role locators skip hidden elements unless told otherwise.
describe('Shell', () => {
  it('opens on the catalog with a tab bar on a phone and switches tabs', async () => {
    renderIonic(<Shell initialPath="/" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect.element(nav).toBeVisible()
    await nav.getByText('Lists').click()
    await expect.element(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
    await expect
      .element(page.getByRole('navigation', { name: 'Sidebar', includeHidden: true }))
      .not.toBeVisible()
  })

  it('shows a sidebar instead of the tab bar on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      renderIonic(<Shell initialPath="/settings" />, { db: openTestDb() })
      await expect.element(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
      await expect.element(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible()
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      await expect.element(sidebar.getByText('Crosstune')).toBeVisible()
      await expect
        .element(page.getByRole('navigation', { name: 'Primary', includeHidden: true }))
        .not.toBeVisible()
      await sidebar.getByText('Recordings').click()
      await expect
        .element(page.getByRole('heading', { name: 'Recordings', level: 1 }))
        .toBeVisible()
      await expect.element(page.getByText(NO_RECORDINGS_TITLE)).toBeVisible()
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('sets the sidebar lockup in the app type role', async () => {
    await page.viewport(1024, 768)
    try {
      renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      const lockup = sidebar.getByText('Crosstune')
      await expect.element(lockup).toBeVisible()
      const element = lockup.element() as HTMLElement
      expect(element.className).toMatch(/\btype-\S+/)
      const wrapper = (element.parentElement as HTMLElement).className
      expect(`${element.className} ${wrapper}`).not.toMatch(AD_HOC_TYPE)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('redirects an old tune link into the catalog stack', async () => {
    const db = openTestDb()
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    renderIonic(<Shell initialPath={`/tunes/${tuneId}`} />, { db })
    await expect
      .element(page.getByRole('heading', { name: "Soldier's Joy", level: 1 }))
      .toBeVisible()
    await expect.poll(() => document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('returns to the tune a tab was showing after switching tabs in the sidebar', async () => {
    await page.viewport(1024, 768)
    try {
      const db = openTestDb()
      const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
      renderIonic(<Shell initialPath={`/catalog/${tuneId}`} />, { db })
      const tune = page.getByRole('heading', { name: "Soldier's Joy", level: 1 })
      await expect.element(tune).toBeVisible()
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      await sidebar.getByText('Lists').click()
      await expect.element(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
      await sidebar.getByText('Catalog').click()
      await expect.element(tune).toBeVisible()
      await expect
        .element(sidebar.getByRole('listitem').first())
        .toHaveAttribute('aria-current', 'page')
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('switches pages without a transition on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
      await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
      const outlet = document.querySelector('ion-router-outlet')!
      expect(outlet.animated).toBe(false)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('turns off the edge swipe that would open the sidebar on a phone', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    // A programmatic open() ignores swipeGesture, so the setting itself is what can be checked.
    expect(document.querySelector('ion-menu')!.swipeGesture).toBe(false)
  })

  it('stays on the current page when the record button is tapped', async () => {
    fakeSilentMedia()
    renderIonic(<Shell initialPath="/lists" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: RECORD_LABEL }).click()
    // The modal covers the page and takes the accessible tree with it, so it closes first.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
    await expect
      .element(page.getByRole('tab', { name: 'Lists' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('restores the real microphone globals once the record modal test ends', () => {
    // A stub left stubbed here would silently fake the microphone for every later test in the file.
    expect(window.MediaRecorder).not.toBe(FakeRecorder)
  })

  it('opens the record modal from the tab bar dome', async () => {
    fakeSilentMedia()
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: RECORD_LABEL }).click()
    await expect.element(page.getByText(NEW_RECORDING)).toBeVisible()
  })

  it('opens the record modal from the sidebar on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      fakeSilentMedia()
      renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      await expect.element(sidebar.getByText('Record')).toBeVisible()
      await sidebar.getByRole('button', { name: RECORD_LABEL }).click()
      await expect.element(page.getByText(NEW_RECORDING)).toBeVisible()
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('raises the record button above the tab bar with content visible beside it', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    const record = page.getByRole('button', { name: RECORD_LABEL })
    await expect.element(record).toBeVisible()
    const dome = record.element().getBoundingClientRect()
    const bar = document.querySelector('ion-tab-bar')!.getBoundingClientRect()
    expect(dome.top).toBeLessThan(bar.top)
    expect(dome.height).toBeGreaterThan(bar.height)
    expect(Math.abs(dome.left + dome.width / 2 - (bar.left + bar.width / 2))).toBeLessThan(1)
    // Beside the dome, just above the bar, the page is what a tap reaches.
    const beside = document.elementFromPoint(bar.left + 8, bar.top - 4)
    expect(beside?.closest('ion-router-outlet')).not.toBeNull()
    expect(page.getByRole('tab').elements()).toHaveLength(4)
    const slots = Array.from(document.querySelectorAll('ion-tab-bar > ion-tab-button'))
    const center = slots[2]!.getBoundingClientRect()
    expect(slots).toHaveLength(5)
    expect(Math.abs(center.left + center.width / 2 - (dome.left + dome.width / 2))).toBeLessThan(1)
    const labels = Array.from(document.querySelectorAll('ion-tab-bar ion-label'))
    expect(labels.filter((label) => label.scrollWidth > label.clientWidth)).toEqual([])
  })

  it('lets the last of a screen scroll clear of the record button', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    const cap = getComputedStyle(document.documentElement).getPropertyValue('--tab-bar-cap').trim()
    expect(cap).not.toBe('')
    expect(cap).not.toBe('0px')
  })

  it('points Back at the parent of a pushed screen', async () => {
    const db = openTestDb()
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    const listId = await createList(db, 'Tuesday jam')
    const cases: [string, string][] = [
      [`/catalog/${tuneId}`, '/catalog'],
      [`/lists/${listId}`, '/lists'],
      [`/lists/${listId}/tunes/${tuneId}`, `/lists/${listId}`],
      [`/recordings/${tuneId}`, '/recordings'],
    ]
    for (const [path, parent] of cases) {
      const view = renderIonic(<Shell initialPath={path} />, { db })
      if (path.includes(tuneId)) {
        await expect
          .element(page.getByRole('heading', { name: "Soldier's Joy", level: 1 }))
          .toBeVisible()
      }
      await expect.poll(() => document.querySelector('ion-back-button')?.defaultHref).toBe(parent)
      view.unmount()
    }
  })
})
