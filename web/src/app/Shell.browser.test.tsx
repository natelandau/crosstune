import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { addTunesToList } from '../commands/bulk'
import { createList } from '../commands/lists'
import { createTune } from '../commands/tunes'
import { SEARCH_TUNES } from '../features/catalog/TuneSearch'
import { NEW_RECORDING } from '../features/recording/RecordModal'
import { keyCellLabel, STATS_TITLE, summaryLine } from '../features/stats/copy'
import { NO_RECORDINGS_TITLE } from '../features/recordings/RecordingsPage'
import { openTestDb } from '../test/db'
import { FakeRecorder, stubMediaGlobals } from '../test/fakeMedia'
import { renderIonic } from '../test/ionic'
import { Shell } from './Shell'
import { RECORD_LABEL, TABS } from './tabs'
import { CANCEL } from '../ui/Confirm'

// The settings screen reads the account from Clerk, which only answers under a ClerkProvider.
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ signOut: async () => {} }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'nate@example.com' } } }),
}))

// A size, weight, or tracking utility. A type role carries all three, so a screen that sets one
// of its own has stepped outside the roles. `text-xl` carries no digit; `text-2xl` and up do.
const AD_HOC_TYPE = /\btext-(xs|sm|base|lg|\d?xl)\b|\bfont-\w+\b|\btracking-\w+\b/

const [CATALOG, , , SETTINGS] = TABS

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

  it('keeps the phone frame on a landscape phone', async () => {
    await page.viewport(844, 390)
    try {
      renderIonic(<Shell initialPath="/" />, { db: openTestDb() })
      await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
      await expect.element(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      await expect
        .element(page.getByRole('navigation', { name: 'Sidebar', includeHidden: true }))
        .not.toBeVisible()
    } finally {
      await page.viewport(390, 844)
    }
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

  it('opens a tune from a link saved under songs', async () => {
    const db = openTestDb()
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    renderIonic(<Shell initialPath={`/songs/${tuneId}`} />, { db })
    await expect
      .element(page.getByRole('heading', { name: "Soldier's Joy", level: 1 }))
      .toBeVisible()
    await expect.poll(() => document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('opens a tune in its list from a list link saved under songs', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: "Soldier's Joy" },
      { status: 'known' },
    )
    const listId = await createList(db, 'Friday')
    await addTunesToList(db, listId, [userTuneId])
    renderIonic(<Shell initialPath={`/lists/${listId}/songs/${tuneId}`} />, { db })
    await expect
      .element(page.getByRole('heading', { name: "Soldier's Joy", level: 1 }))
      .toBeVisible()
    await expect
      .poll(() => document.querySelector('ion-back-button')?.defaultHref)
      .toBe(`/lists/${listId}`)
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
      await expect.poll(() => document.querySelector('ion-router-outlet')!.animated).toBe(false)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('turns off the edge swipe that would open the sidebar on a phone', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    // A programmatic open() ignores swipeGesture, so the setting itself is what can be checked.
    await expect.poll(() => document.querySelector('ion-menu')!.swipeGesture).toBe(false)
  })

  it('stays on the current page when the record button is tapped', async () => {
    fakeSilentMedia()
    renderIonic(<Shell initialPath="/lists" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Lists', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: RECORD_LABEL }).click()
    // The modal covers the page and takes the accessible tree with it, so it closes first.
    await page.getByRole('button', { name: CANCEL, exact: true }).click()
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
    const dome = () => record.element().getBoundingClientRect()
    const bar = () => document.querySelector('ion-tab-bar')!.getBoundingClientRect()
    const middle = (box: DOMRect) => box.left + box.width / 2
    await expect.poll(() => dome().top - bar().top).toBeLessThan(0)
    await expect.poll(() => dome().height - bar().height).toBeGreaterThan(0)
    await expect.poll(() => Math.abs(middle(dome()) - middle(bar()))).toBeLessThan(1)
    // Beside the dome, just above the bar, the page is what a tap reaches.
    await expect
      .poll(() =>
        document.elementFromPoint(bar().left + 8, bar().top - 4)?.closest('ion-router-outlet'),
      )
      .not.toBeNull()
    await expect.poll(() => page.getByRole('tab').elements()).toHaveLength(4)
    const slots = () => Array.from(document.querySelectorAll('ion-tab-bar > ion-tab-button'))
    await expect.poll(slots).toHaveLength(5)
    await expect
      .poll(() => Math.abs(middle(slots()[2]!.getBoundingClientRect()) - middle(dome())))
      .toBeLessThan(1)
    await expect
      .poll(() =>
        Array.from(document.querySelectorAll('ion-tab-bar ion-label')).filter(
          (label) => label.scrollWidth > label.clientWidth,
        ),
      )
      .toEqual([])
  })

  it('lets the last of a screen scroll clear of the record button', async () => {
    renderIonic(<Shell initialPath="/catalog" />, { db: openTestDb() })
    await expect.element(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible()
    const cap = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--tab-bar-cap').trim()
    await expect.poll(cap).not.toBe('')
    await expect.poll(cap).not.toBe('0px')
  })

  it('keeps the record button clearance on a landscape phone and drops it on the wide frame', async () => {
    const readCap = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--tab-bar-cap').trim()
    await page.viewport(844, 390)
    try {
      await expect.poll(readCap).not.toBe('0px')
      await page.viewport(1024, 768)
      await expect.poll(readCap).toBe('0px')
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('opens a stats value as the catalog tab at its root, and keeps stats in Settings', async () => {
    const db = openTestDb()
    await createTune(db, { title: 'Sally Ann', key: 'D' }, { status: 'known' })
    renderIonic(<Shell initialPath="/catalog" />, { db })
    await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally')
    await page.getByRole('button', { name: /^Sally Ann/ }).click()
    const tune = page.getByRole('heading', { name: 'Sally Ann', level: 1 })
    await expect.element(tune).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByText(SETTINGS.label).click()
    await page
      .getByRole('button', {
        name: summaryLine({ tunes: 1, lists: 0, recordings: 0, scans: 0, ms: 0 }),
      })
      .click()
    await page.getByRole('button', { name: keyCellLabel('D', 1) }).click()
    await expect.element(page.getByRole('heading', { name: CATALOG.label, level: 1 })).toBeVisible()
    await expect.poll(() => tune.elements()).toHaveLength(0)
    await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toHaveValue('')
    await expect
      .element(page.getByRole('tab', { name: CATALOG.label }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(page.getByRole('button', { name: 'back' })).not.toBeInTheDocument()
    await nav.getByText(SETTINGS.label).click()
    await expect.element(page.getByRole('heading', { name: STATS_TITLE, level: 1 })).toBeVisible()
  })

  it('opens a stats value at the catalog root from the sidebar on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      const db = openTestDb()
      await createTune(db, { title: 'Sally Ann', key: 'D' }, { status: 'known' })
      renderIonic(<Shell initialPath="/catalog" />, { db })
      await page.getByRole('searchbox', { name: SEARCH_TUNES }).fill('Sally')
      await page.getByRole('button', { name: /^Sally Ann/ }).click()
      const tune = page.getByRole('heading', { name: 'Sally Ann', level: 1 })
      await expect.element(tune).toBeVisible()
      const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
      await sidebar.getByText(SETTINGS.label).click()
      await page
        .getByRole('button', {
          name: summaryLine({ tunes: 1, lists: 0, recordings: 0, scans: 0, ms: 0 }),
        })
        .click()
      await page.getByRole('button', { name: keyCellLabel('D', 1) }).click()
      await expect
        .element(page.getByRole('heading', { name: CATALOG.label, level: 1 }))
        .toBeVisible()
      await expect.poll(() => tune.elements()).toHaveLength(0)
      await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toHaveValue('')
      await expect
        .element(sidebar.getByRole('listitem').first())
        .toHaveAttribute('aria-current', 'page')
      await expect.element(page.getByRole('button', { name: 'back' })).not.toBeInTheDocument()
      await sidebar.getByText(SETTINGS.label).click()
      await expect.element(page.getByRole('heading', { name: STATS_TITLE, level: 1 })).toBeVisible()
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('opens a stats value in a catalog tab not yet visited', async () => {
    const db = openTestDb()
    await createTune(db, { title: 'Sally Ann', key: 'D' }, { status: 'known' })
    renderIonic(<Shell initialPath="/settings/stats" />, { db })
    await page.getByRole('button', { name: keyCellLabel('D', 1) }).click()
    await expect.element(page.getByRole('heading', { name: CATALOG.label, level: 1 })).toBeVisible()
    await expect
      .element(page.getByRole('tab', { name: CATALOG.label }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(page.getByRole('button', { name: 'back' })).not.toBeInTheDocument()
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
