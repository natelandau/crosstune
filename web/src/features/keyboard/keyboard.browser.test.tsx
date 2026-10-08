import { useState, type ReactElement } from 'react'
import { page, userEvent, type Locator } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import { SEARCH_TUNES, TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'
import { PAUSE, PLAY } from '../player/transportCopy'
import { NEW_RECORDING } from '../capture/recordCopy'
import { EDIT_SELECTED, editTunesTitle, selectedTitle } from '../selection/selectionCopy'
import { NEW_TUNE_TITLE } from '../tune/tuneFormCopy'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import type { PlaybackEngine } from '../player/playbackEngine'
import { CANCEL, DONE } from '../../ui/confirmCopy'
import { GO_SEQUENCE_MS } from './goSequence'
import { keySpoken, QUICK_FIND, SHORTCUTS, SHORTCUTS_TITLE } from './keymap'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { YEAR_LABEL } from '../../ui/partialDate'
import { useBackEntry } from '../../ui/backEntries'
import { destination } from '../../app/destinations'

import type { AppRouter } from '../../app/router'
import { SIDEBAR } from '../../app/Sidebar'
import {
  mountPlaying,
  openButton,
  openPractice,
  player,
  practice,
  press,
  WIDE,
} from '../../test/practice'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import type { TuneFormLauncher } from '../tune/formLauncher'
import { TUNE } from '../tune/tunePageCopy'
import { ShortcutSheet } from './ShortcutSheet'
import { ShortcutSheetContext } from './shortcutSheetLauncher'

const PHONE = { width: 390, height: 844 }

const search = () => page.getByRole('searchbox', { name: SEARCH_TUNES })

/** Every pathname the router lands on after this call, in order. */
function visits(router: AppRouter): string[] {
  const seen: string[] = []
  const unsubscribe = router.subscribe((state) => {
    if (state.navigation.state === 'idle') seen.push(state.location.pathname)
  })
  onTestFinished(unsubscribe)
  return seen
}

/** Puts focus back on the page itself, where a single-key shortcut is meant for the app. */
function focusBody() {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

async function mountCatalog(
  options: { launcher?: TuneFormLauncher; density?: 'pointer' | 'touch'; frame?: typeof WIDE } = {},
) {
  const db = openTestDb()
  await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
  const app = await renderApp({
    path: '/catalog',
    db,
    frame: options.frame ?? WIDE,
    density: options.density ?? 'pointer',
    launcher: options.launcher,
  })
  await expect.element(search()).toBeVisible()
  return app
}

it('focuses the catalog search on /', async () => {
  await mountCatalog()
  focusBody()
  await userEvent.keyboard('/')
  await expect.element(search()).toHaveFocus()
  await expect.element(search()).toHaveValue('')
})

it('leaves / to the browser on a tune page that hides the catalog search', async () => {
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
  await renderApp({
    path: `/catalog/${tuneId}`,
    db,
    frame: { width: 900, height: 800 },
    density: 'pointer',
  })
  await expect.element(page.getByRole('main', { name: TUNE })).toHaveTextContent('Old Joe Clark')
  await expect
    .element(page.getByRole('searchbox', { name: SEARCH_TUNES, includeHidden: true }))
    .not.toBeVisible()
  const heard: KeyboardEvent[] = []
  const hear = (event: KeyboardEvent) => heard.push(event)
  window.addEventListener('keydown', hear)
  onTestFinished(() => window.removeEventListener('keydown', hear))

  focusBody()
  await userEvent.keyboard('/')
  await expect.poll(() => heard.map((event) => event.key)).toEqual(['/'])
  expect(heard[0]!.defaultPrevented).toBe(false)
})

it('types n into the search without opening the tune form', async () => {
  const open = vi.fn()
  await mountCatalog({ launcher: { open } })
  await search().click()
  await userEvent.keyboard('n')
  await expect.element(search()).toHaveValue('n')
  expect(open).not.toHaveBeenCalled()
})

it('opens the tune form for a new tune on N', async () => {
  await mountCatalog()
  focusBody()
  await userEvent.keyboard('n')
  await expect.element(page.getByRole('dialog', { name: NEW_TUNE_TITLE })).toBeVisible()
})

it('opens the record sheet on R', async () => {
  fakeMediaForTest()
  await mountCatalog()
  focusBody()
  await userEvent.keyboard('r')
  await expect.element(page.getByRole('dialog', { name: NEW_RECORDING })).toBeVisible()
})

it('goes to Lists on G then L', async () => {
  const { router } = await mountCatalog()
  focusBody()
  await userEvent.keyboard('gl')
  await expect.poll(() => router.state.location.pathname).toBe('/lists')
})

it('drops G once the sequence has timed out', async () => {
  const { router } = await mountCatalog()
  const seen = visits(router)
  vi.useFakeTimers({ toFake: ['Date'] })
  focusBody()
  await userEvent.keyboard('g')
  vi.setSystemTime(Date.now() + GO_SEQUENCE_MS + 1)
  await userEvent.keyboard('l')

  await userEvent.keyboard('gs')
  await expect.poll(() => router.state.location.pathname).toBe('/settings')
  expect(seen).toEqual(['/settings'])
})

it('types l into the search when a click lands between G and L', async () => {
  const { router } = await mountCatalog()
  const seen = visits(router)
  focusBody()
  await userEvent.keyboard('g')
  await search().click()
  await userEvent.keyboard('l')
  await expect.element(search()).toHaveValue('l')

  focusBody()
  await userEvent.keyboard('gs')
  await expect.poll(() => router.state.location.pathname).toBe('/settings')
  expect(seen).toEqual(['/settings'])
})

const LOOSE_ROW = 'Loose row'
const LOOSE_BUTTON = 'Loose button'

/** The app beside a bare row and a bare button, neither of which stops a keystroke. */
const besideLoose = (app: ReactElement) => (
  <>
    {app}
    <div role="row" tabIndex={0} aria-label={LOOSE_ROW} />
    <button type="button">{LOOSE_BUTTON}</button>
  </>
)

/**
 * Presses Space on `target`, then on the body, and expects only the body's press to pause the
 * loaded recording.
 */
async function expectSpaceLeftTo(target: Locator, engine: PlaybackEngine) {
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  const pause = vi.spyOn(engine, 'pause')
  const play = vi.spyOn(engine, 'play')

  ;(target.element() as HTMLElement).focus()
  await expect.element(target).toHaveFocus()
  await userEvent.keyboard(' ')

  focusBody()
  await userEvent.keyboard(' ')
  await expect.element(player().getByRole('button', { name: PLAY, exact: true })).toBeVisible()
  expect(pause).toHaveBeenCalledTimes(1)
  expect(play).not.toHaveBeenCalled()
}

it('pauses a loaded recording on Space, and leaves Space to a focused row', async () => {
  const { engine } = await mountPlaying(WIDE, { wrap: besideLoose })
  await expectSpaceLeftTo(page.getByRole('row', { name: LOOSE_ROW }), engine)
})

it('leaves Space to a focused button', async () => {
  const { engine } = await mountPlaying(WIDE, { wrap: besideLoose })
  await expectSpaceLeftTo(page.getByRole('button', { name: LOOSE_BUTTON }), engine)
})

it('runs letter shortcuts with focus on a sidebar link', async () => {
  const open = vi.fn()
  const { router } = await mountCatalog({ launcher: { open } })
  const link = page
    .getByRole('navigation', { name: SIDEBAR })
    .getByRole('link', { name: destination('catalog').label, exact: true })
  await link.click()
  await expect.element(link).toHaveFocus()

  await userEvent.keyboard('n')
  await expect.poll(() => open.mock.calls.length).toBe(1)
  await expect.element(link).toHaveFocus()
  await userEvent.keyboard('gl')
  await expect.poll(() => router.state.location.pathname).toBe('/lists')
})

it('ends the go sequence on an unknown key, which then does nothing', async () => {
  const open = vi.fn()
  const { router } = await mountCatalog({ launcher: { open } })
  const seen = visits(router)
  const heard: string[] = []
  const hear = (event: KeyboardEvent) => heard.push(event.key)
  window.addEventListener('keydown', hear)
  onTestFinished(() => window.removeEventListener('keydown', hear))

  focusBody()
  await userEvent.keyboard('gn')
  await expect.poll(() => heard).toEqual(['g', 'n'])
  expect(open).not.toHaveBeenCalled()
  expect(seen).toEqual([])
})

/** The catalog with a tune for N and one for G, focus on the row clicked to open the first. */
async function mountOnRow(launcher: TuneFormLauncher) {
  const db = openTestDb()
  await createTune(db, { title: 'Nail That Catfish' }, { status: 'known' })
  await createTune(db, { title: 'Glory in the Meeting House' }, { status: 'known' })
  const app = await renderApp({ path: '/catalog', db, frame: WIDE, density: 'pointer', launcher })
  const row = tuneRow('Nail')
  await row.click()
  await expect.poll(() => app.router.state.location.pathname).not.toBe('/catalog')
  // Keys land once the open tune has settled, as a musician's would.
  await expect.element(page.getByRole('main', { name: TUNE })).toHaveTextContent('Nail')
  await expect.element(row).toHaveFocus()
  return app
}

it('opens the tune form on N with focus on a row a tune with N heads', async () => {
  const open = vi.fn()
  await mountOnRow({ open })
  await userEvent.keyboard('n')
  await expect.poll(() => open.mock.calls.length).toBe(1)
})

it('goes to Lists on G then L with focus on a row, past a tune with G', async () => {
  const { router } = await mountOnRow({ open: vi.fn() })
  await userEvent.keyboard('gl')
  await expect.poll(() => router.state.location.pathname).toBe('/lists')
})

it('leaves N alone at touch density', async () => {
  const open = vi.fn()
  await mountCatalog({ launcher: { open }, density: 'touch', frame: PHONE })
  await expect.poll(() => document.documentElement.dataset.density).toBe('touch')
  const heard: string[] = []
  const hear = (event: KeyboardEvent) => heard.push(event.key)
  window.addEventListener('keydown', hear)
  onTestFinished(() => window.removeEventListener('keydown', hear))

  focusBody()
  await userEvent.keyboard('n')
  await expect.poll(() => heard).toEqual(['n'])
  expect(open).not.toHaveBeenCalled()
})

it('opens the shortcut sheet on ?, and types ? in a field', async () => {
  const open = vi.fn()
  const db = openTestDb()
  await renderApp({ path: '/catalog', db, frame: WIDE, shortcutSheet: { open } })
  await search().click()
  await userEvent.keyboard('?')
  await expect.element(search()).toHaveValue('?')
  expect(open).not.toHaveBeenCalled()

  focusBody()
  await userEvent.keyboard('?')
  await expect.poll(() => open.mock.calls.length).toBe(1)
})

const shortcutSheet = () => page.getByRole('dialog', { name: SHORTCUTS_TITLE })

it('opens the shortcut sheet on ?, with every shortcut under its group', async () => {
  await mountCatalog()
  focusBody()
  await userEvent.keyboard('?')
  const sheet = shortcutSheet()
  await expect.element(sheet).toBeVisible()
  for (const { group, label } of SHORTCUTS) {
    await expect
      .element(sheet.getByRole('region', { name: group }).getByText(label, { exact: true }))
      .toBeVisible()
  }
})

it('shows the command key as ⌘ on a Mac, named as spoken', async () => {
  renderWithProviders(
    <ShortcutSheetContext.Provider value={{ shown: true, open: () => {}, close: () => {} }}>
      <ShortcutSheet platform="mac" />
    </ShortcutSheetContext.Provider>,
  )
  const row = shortcutSheet().getByRole('listitem').filter({ hasText: QUICK_FIND })
  await expect.element(row.getByText('⌘', { exact: true })).toBeVisible()
  await expect.element(row.getByText('K', { exact: true })).toBeVisible()
  await expect.element(row).toHaveTextContent(`${keySpoken('Meta', 'mac')}`)
})

it('closes the shortcut sheet on Escape, back to where focus was', async () => {
  await mountCatalog()
  const link = page
    .getByRole('navigation', { name: SIDEBAR })
    .getByRole('link', { name: destination('catalog').label, exact: true })
  await link.click()
  await expect.element(link).toHaveFocus()
  await userEvent.keyboard('?')
  await expect.element(shortcutSheet()).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(shortcutSheet()).not.toBeInTheDocument()
  await expect.element(link).toHaveFocus()
})

const tunes = () => page.getByRole('grid', { name: TUNE_LIST })
const tuneRow = (title: string) => tunes().getByRole('row', { name: new RegExp(title) })
const selected = (count: number) => page.getByText(selectedTitle(count), { exact: true })

/** The catalog at /catalog, selecting two tunes, with every later visit recorded. */
async function mountSelecting() {
  const db = openTestDb()
  await createTune(db, { title: 'Angeline the Baker' }, { status: 'known' })
  await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  const { router } = await renderApp({ path: '/catalog', db, frame: WIDE, density: 'pointer' })
  await expect.element(tuneRow('Cluck')).toBeVisible()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  await tuneRow('Angeline').click()
  await tuneRow('Cluck').click()
  await expect.element(selected(2)).toBeVisible()
  return { router, seen: visits(router) }
}

it('closes a menu on the first Escape and leaves selection on the second', async () => {
  const { router, seen } = await mountSelecting()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await expect.element(page.getByRole('menu')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(selected(2)).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(selected(2)).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/catalog')
  expect(seen).toEqual([])
})

it('leaves selection on Escape from a focused row, rather than only emptying it', async () => {
  await mountSelecting()
  await expect.element(tuneRow('Cluck')).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  // The grid's own Escape would empty the selection and leave the mode, and its Done, standing.
  await expect.element(page.getByRole('button', { name: DONE })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: MORE_ACTIONS })).toBeVisible()
  await expect.element(page.getByText(selectedTitle(0), { exact: true })).not.toBeInTheDocument()
})

it('holds a locked sheet and the selection under it against Escape', async () => {
  await mountSelecting()
  await page.getByRole('button', { name: EDIT_SELECTED, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: editTunesTitle(2) })
  await sheet.getByRole('textbox', { name: YEAR_LABEL }).fill('2024')
  await sheet.getByRole('heading', { name: editTunesTitle(2) }).click()

  await userEvent.keyboard('{Escape}')
  await expect.element(sheet.getByRole('textbox', { name: YEAR_LABEL })).toHaveValue('2024')
  await sheet.getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(selected(2)).toBeVisible()
})

it('steps out of a loop, then practice, then nothing, one per Escape', async () => {
  const { engine, router } = await mountPlaying(WIDE)
  const seen = visits(router)
  await openPractice()
  const expand = openButton().element()
  press('n')
  await expect.poll(() => engine.getState().loop).not.toBeNull()

  await userEvent.keyboard('{Escape}')
  await expect.poll(() => engine.getState().loop).toBeNull()
  expect(practice()).not.toBeNull()

  await userEvent.keyboard('{Escape}')
  await expect.poll(practice).toBeNull()
  await expect.poll(() => document.activeElement).toBe(expand)

  await userEvent.keyboard('{Escape}')
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  expect(practice()).toBeNull()
  expect(document.activeElement).toBe(expand)
  expect(seen).toEqual([])
})

/** A screen state on the back stack, such as selection, held until its way out runs. */
function HeldState({ name, left }: { name: string; left: string[] }) {
  const [held, setHeld] = useState(true)
  useBackEntry(
    {
      layer: 'screen',
      back: () => {
        left.push(name)
        setHeld(false)
      },
    },
    held,
  )
  return null
}

it.each(['pointer', 'touch'] as const)(
  'steps out of the newest screen state on each Escape at %s density',
  async (density) => {
    const left: string[] = []
    const db = openTestDb()
    const { router } = await renderApp({
      path: '/catalog',
      db,
      frame: density === 'pointer' ? WIDE : PHONE,
      density,
      wrap: (app) => (
        <>
          {app}
          <HeldState name="older" left={left} />
          <HeldState name="newer" left={left} />
        </>
      ),
    })
    await expect.element(search()).toBeVisible()
    const seen = visits(router)
    focusBody()

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => left).toEqual(['newer'])
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => left).toEqual(['newer', 'older'])
    // The press runs any way out before userEvent's keydown resolves.
    await userEvent.keyboard('{Escape}')
    expect(left).toEqual(['newer', 'older'])
    expect(seen).toEqual([])
  },
)
