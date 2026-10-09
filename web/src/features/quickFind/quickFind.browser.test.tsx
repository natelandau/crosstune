import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import { SEARCH_TUNES, TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'
import { CATALOG_SORT_LABELS } from '../catalog/catalogSort'
import { NEW_LIST_TITLE } from '../lists/listsCopy'
import { NO_MATCHES, QUICK_FIND_PLACEHOLDER, QUICK_FIND_SECTIONS } from './quickFindResults'
import { NEW_TUNE_TITLE } from '../tune/tuneFormCopy'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { QUICK_FIND, SHORTCUTS_TITLE } from '../keyboard/keymap'
import { SORT_BY } from '../../ui/sortCopy'
import { readBackEntries } from '../../ui/backEntries'

import { SHEET } from '../../ui/sheetGeometry'
import { WIDE } from '../../test/practice'
import { useAndroidBackForTest } from '../../test/androidBack'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { TuneFormLauncherContext, type TuneFormLauncher } from '../tune/formLauncher'
import { isQuietPick } from '../tune/tunePick'
import { TUNE } from '../tune/tunePageCopy'
import { QuickFind } from './QuickFind'
import { QuickFindContext } from './quickFindLauncher'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const PHONE = { width: 390, height: 844 }

const quickFind = () => page.getByRole('dialog', { name: QUICK_FIND })
const field = () => quickFind().getByPlaceholder(QUICK_FIND_PLACEHOLDER)
const section = (id: keyof typeof QUICK_FIND_SECTIONS) =>
  quickFind().getByRole('group', { name: QUICK_FIND_SECTIONS[id] })
const command = (label: string) =>
  section('commands').getByRole('option', { name: new RegExp(`^${label}`) })
const overlays = () => readBackEntries().filter((entry) => entry.layer === 'overlay').length

/** Reads the platform as a Mac's, so Cmd is the command key, or as anything else's, for Ctrl. */
function onPlatform(platform: 'MacIntel' | 'Linux x86_64') {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
}

const commandK = () => userEvent.keyboard('{Meta>}k{/Meta}')
const controlK = () => userEvent.keyboard('{Control>}k{/Control}')

/** Every K pressed with a modifier, as it reaches the window once every handler has run. */
function heardK(): KeyboardEvent[] {
  const heard: KeyboardEvent[] = []
  const hear = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) heard.push(event)
  }
  window.addEventListener('keydown', hear)
  onTestFinished(() => window.removeEventListener('keydown', hear))
  return heard
}

function focusBody() {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

async function seeded(): Promise<{ db: CrosstuneDb; joy: string }> {
  const db = openTestDb()
  const { tuneId: joy } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
  await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  return { db, joy }
}

async function mount(
  path: string,
  options: {
    db?: CrosstuneDb
    frame?: typeof WIDE
    density?: 'pointer' | 'touch'
    launcher?: TuneFormLauncher
  } = {},
) {
  const db = options.db ?? (await seeded()).db
  const app = await renderApp({
    path,
    db,
    frame: options.frame ?? WIDE,
    density: options.density ?? 'pointer',
    launcher: options.launcher,
  })
  return app
}

it('opens on Cmd-K with focus in its field, and opens a found tune on Enter', async () => {
  onPlatform('MacIntel')
  const { db, joy } = await seeded()
  const { router } = await mount('/catalog', { db })
  await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toBeVisible()
  focusBody()
  const heard = heardK()

  await commandK()
  await expect.element(field()).toHaveFocus()
  await expect.poll(() => heard.length).toBe(1)
  expect(heard[0]!.defaultPrevented).toBe(true)
  await userEvent.keyboard('soldier')
  await expect
    .element(section('tunes').getByRole('option', { name: /Soldier's Joy/ }))
    .toBeVisible()

  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${joy}`)
  await expect.element(quickFind()).not.toBeInTheDocument()
  await expect.poll(overlays).toBe(0)
})

it('swaps in a clicked tune with motion, and one chosen from the keyboard without', async () => {
  onPlatform('MacIntel')
  const { db, joy } = await seeded()
  const { router } = await mount('/catalog', { db })
  await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toBeVisible()
  const joyOption = () => section('tunes').getByRole('option', { name: /Soldier's Joy/ })
  focusBody()

  await commandK()
  await userEvent.keyboard('soldier')
  await joyOption().click()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${joy}`)
  expect(isQuietPick(router.state.location.state)).toBe(false)
  // Cmd-K stands down until the closing Quick Find lets go of the overlay stack.
  await expect.poll(overlays).toBe(0)

  await router.navigate('/catalog')
  focusBody()
  await commandK()
  await expect.element(field()).toHaveFocus()
  await userEvent.keyboard('soldier')
  await expect.element(joyOption()).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${joy}`)
  expect(isQuietPick(router.state.location.state)).toBe(true)
})

it('opens on Cmd-K from a text field', async () => {
  onPlatform('MacIntel')
  await mount('/catalog')
  await page.getByRole('searchbox', { name: SEARCH_TUNES }).click()
  await commandK()
  await expect.element(field()).toHaveFocus()
  await expect.element(page.getByRole('searchbox', { name: SEARCH_TUNES })).toHaveValue('')
})

it.each(['pointer', 'touch'] as const)(
  'rings its whole field capsule at %s density, not the input inside it',
  async (density) => {
    onPlatform('MacIntel')
    await mount('/catalog', density === 'touch' ? { frame: PHONE, density } : { density })
    focusBody()
    await commandK()
    await expect.element(field()).toHaveFocus()
    const input = field().element()
    const outline = (element: Element) => getComputedStyle(element).outlineStyle
    await expect.poll(() => outline(input.parentElement!)).toBe('solid')
    await expect.poll(() => outline(input)).toBe('none')
  },
)

it('opens on Ctrl-K at 390 as a full-height sheet, and pushes a chosen tune', async () => {
  onPlatform('Linux x86_64')
  const { db, joy } = await seeded()
  const { router } = await mount('/catalog', { db, frame: PHONE, density: 'touch' })
  await expect.element(page.getByRole('grid', { name: TUNE_LIST })).toBeVisible()
  focusBody()

  await controlK()
  await expect.element(field()).toHaveFocus()
  await expect
    .poll(() => Math.round(quickFind().element().getBoundingClientRect().top))
    .toBe(SHEET.topMargin)

  await userEvent.keyboard('soldier')
  await section('tunes')
    .getByRole('option', { name: /Soldier's Joy/ })
    .click()
  await expect.poll(() => router.state.location.pathname).toBe(`/catalog/${joy}`)
  await expect
    .element(page.getByRole('main', { name: TUNE }).getByRole('heading', { level: 1 }))
    .toHaveTextContent("Soldier's Joy")
  await expect.poll(overlays).toBe(0)
})

it('puts focus back in its field on a second Cmd-K', async () => {
  onPlatform('MacIntel')
  await mount('/catalog')
  focusBody()
  await commandK()
  await expect.element(field()).toHaveFocus()
  ;(quickFind().element() as HTMLElement).focus()
  await expect.element(field()).not.toHaveFocus()
  await commandK()
  await expect.element(field()).toHaveFocus()
})

it('leaves Cmd-K alone while another overlay is open', async () => {
  onPlatform('MacIntel')
  await mount('/catalog')
  focusBody()
  await userEvent.keyboard('?')
  await expect.element(page.getByRole('dialog', { name: SHORTCUTS_TITLE })).toBeVisible()
  const heard = heardK()
  await commandK()
  await expect.poll(() => heard.length).toBe(1)
  expect(heard[0]!.defaultPrevented).toBe(false)
  await expect.element(page.getByRole('dialog', { name: SHORTCUTS_TITLE })).toBeVisible()
  expect(quickFind().query()).toBeNull()
})

it('closes on Escape, leaving the address and no overlay behind', async () => {
  onPlatform('MacIntel')
  const { router } = await mount('/catalog')
  focusBody()
  await commandK()
  await userEvent.keyboard('cluck')
  await expect.element(section('tunes')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(quickFind()).not.toBeInTheDocument()
  await expect.poll(overlays).toBe(0)
  expect(router.state.location.pathname).toBe('/catalog')
})

it('opens the list name sheet from Settings through New list', async () => {
  onPlatform('MacIntel')
  await mount('/settings')
  focusBody()
  await commandK()
  await userEvent.keyboard('new list')
  await command(NEW_LIST_TITLE).click()
  await expect.element(page.getByRole('dialog', { name: NEW_LIST_TITLE })).toBeVisible()
  await expect.element(quickFind()).not.toBeInTheDocument()
})

it('offers Select tunes on the catalog and not on Settings', async () => {
  onPlatform('MacIntel')
  const { router } = await mount('/catalog')
  focusBody()
  await commandK()
  await expect.element(command(SELECT_TUNES)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(quickFind()).not.toBeInTheDocument()

  await router.navigate('/settings')
  // The catalog withdraws its commands as it unmounts, which can land after navigate resolves.
  await expect.element(page.getByRole('grid', { name: TUNE_LIST })).not.toBeInTheDocument()
  focusBody()
  await commandK()
  await expect.element(command(SHORTCUTS_TITLE)).toBeVisible()
  expect(command(SELECT_TUNES).query()).toBeNull()
})

it('sorts the catalog through Sort by, then Title', async () => {
  onPlatform('MacIntel')
  await mount('/catalog', { frame: WIDE })
  const rows = () =>
    page
      .getByRole('grid', { name: TUNE_LIST })
      .getByRole('row')
      .elements()
      .map((row) => row.textContent ?? '')
  await expect.poll(() => rows()[0]).toContain('Cluck Old Hen')
  focusBody()

  await commandK()
  await userEvent.keyboard('sort')
  await command(SORT_BY).click()
  await expect.element(field()).toHaveValue('')
  await quickFind()
    .getByRole('option', { name: new RegExp(`^${CATALOG_SORT_LABELS.title}`) })
    .click()
  await expect.element(quickFind()).not.toBeInTheDocument()
  await expect.poll(() => rows()[0]).toContain("Soldier's Joy")
})

it('shows no matches for a query nothing holds', async () => {
  onPlatform('MacIntel')
  await mount('/catalog')
  focusBody()
  await commandK()
  await userEvent.keyboard('zzz')
  await expect.element(quickFind().getByText(NO_MATCHES, { exact: true })).toBeVisible()
})

it('shows no matches in an empty catalog, and still runs a command', async () => {
  onPlatform('MacIntel')
  const open = vi.fn()
  await mount('/catalog', { db: openTestDb(), launcher: { open } })
  focusBody()
  await commandK()
  await userEvent.keyboard('soldier')
  await expect.element(quickFind().getByText(NO_MATCHES, { exact: true })).toBeVisible()

  await field().clear()
  await userEvent.keyboard('new tune')
  await expect.element(command(NEW_TUNE_TITLE)).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => open.mock.calls).toEqual([[{ source: 'menu' }]])
  await expect.element(quickFind()).not.toBeInTheDocument()
})

it('offers Sort by on Recordings, and opens an unfiled recording there', async () => {
  onPlatform('MacIntel')
  const db = openTestDb()
  await db.recordings.put(recordingRow('r1', { label: 'Porch take' }))
  const { router } = await mount('/catalog', { db })
  await router.navigate('/recordings')
  focusBody()
  await commandK()
  await expect.element(command(SORT_BY)).toBeVisible()
  expect(command(SELECT_TUNES).query()).toBeNull()

  await userEvent.keyboard('porch')
  await expect
    .element(section('recordings').getByRole('option', { name: /Porch take/ }))
    .toBeVisible()
  await router.navigate('/catalog')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => router.state.location.pathname).toBe('/recordings')
})

it('offers Select tunes on a list page, without Sort by', async () => {
  onPlatform('MacIntel')
  const db = openTestDb()
  const listId = await createList(db, 'Thursday jam')
  await mount(`/lists/${listId}`, { db })
  await expect.element(page.getByRole('heading', { name: 'Thursday jam' }).first()).toBeVisible()
  focusBody()
  await commandK()
  await expect.element(command(SELECT_TUNES)).toBeVisible()
  expect(command(SORT_BY).query()).toBeNull()
})

it('closes on back, leaving the address and no overlay behind', async () => {
  onPlatform('MacIntel')
  const android = useAndroidBackForTest()
  const { db } = await seeded()
  const { router } = await renderApp({ path: '/catalog', db, frame: WIDE, android })
  await expect.element(page.getByRole('grid', { name: TUNE_LIST })).toBeVisible()
  focusBody()
  await commandK()
  await expect.element(field()).toHaveFocus()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(quickFind()).not.toBeInTheDocument()
  await expect.poll(overlays).toBe(0)
  expect(router.state.location.pathname).toBe('/catalog')
})

/** Opens Quick Find on the catalog and goes into Sort by, after typing `sort`. */
async function intoSortBy(
  density: 'pointer' | 'touch',
  android?: ReturnType<typeof useAndroidBackForTest>,
) {
  onPlatform('MacIntel')
  const { db } = await seeded()
  const app = await renderApp({
    path: '/catalog',
    db,
    frame: density === 'pointer' ? WIDE : PHONE,
    density,
    android,
  })
  await expect.element(page.getByRole('grid', { name: TUNE_LIST })).toBeVisible()
  focusBody()
  await commandK()
  await userEvent.keyboard('sort')
  await command(SORT_BY).click()
  const title = quickFind().getByRole('option', {
    name: new RegExp(`^${CATALOG_SORT_LABELS.title}`),
  })
  await expect.element(title).toBeVisible()
  await expect.element(field()).toHaveValue('')
  return { ...app, title }
}

it.each(['pointer', 'touch'] as const)(
  'steps out of Sort by on Escape, then closes on the next, at %s density',
  async (density) => {
    const { router, title } = await intoSortBy(density)
    await field().click()
    await userEvent.keyboard('{Escape}')
    await expect.element(title).not.toBeInTheDocument()
    await expect.element(command(SORT_BY)).toBeVisible()
    await expect.element(field()).toHaveValue('sort')
    await expect.poll(overlays).toBe(1)

    await userEvent.keyboard('{Escape}')
    await expect.element(quickFind()).not.toBeInTheDocument()
    await expect.poll(overlays).toBe(0)
    expect(router.state.location.pathname).toBe('/catalog')
  },
)

it('steps out of Sort by on back, then closes on the next', async () => {
  const android = useAndroidBackForTest()
  const { router, title } = await intoSortBy('touch', android)

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(title).not.toBeInTheDocument()
  await expect.element(field()).toHaveValue('sort')
  await expect.element(quickFind()).toBeVisible()

  expect(android.press()).toMatchObject({ kind: 'entry', entry: { layer: 'overlay' } })
  await expect.element(quickFind()).not.toBeInTheDocument()
  await expect.poll(overlays).toBe(0)
  expect(router.state.location.pathname).toBe('/catalog')
})

it.each(['pointer', 'touch'] as const)(
  'steps out of Sort by on Escape with focus on the dialog itself, at %s density',
  async (density) => {
    const { title } = await intoSortBy(density)
    await quickFind().click({ position: { x: 4, y: 4 } })
    await expect.element(quickFind()).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await expect.element(title).not.toBeInTheDocument()
    await expect.element(command(SORT_BY)).toBeVisible()
    await expect.element(field()).toHaveValue('sort')
    await expect.element(quickFind()).toBeVisible()
  },
)

/** Shows and hides Quick Find from the test. */
interface QuickFindControls {
  /** Shows it, and shows it again the moment a choice starts to close it, while it exits. */
  showTwice: () => void
  hide: () => void
}

function ReopenedQuickFind({ controlsRef }: { controlsRef: RefObject<QuickFindControls | null> }) {
  const [shown, setShown] = useState(false)
  const [reopen, setReopen] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    controlsRef.current = {
      showTwice: () => {
        setShown(true)
        setReopen(true)
      },
      hide: () => setShown(false),
    }
  }, [controlsRef])
  useEffect(() => {
    if (shown || !reopen) return
    // Reopens once the close has committed, so the exit is under way and not batched away.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReopen(false)
    setShown(true)
  }, [shown, reopen])
  const state = useMemo(
    () => ({ shown, fieldRef, open: () => setShown(true), close: () => setShown(false) }),
    [shown],
  )
  return (
    <QuickFindContext.Provider value={state}>
      <QuickFind navigate={() => {}} />
    </QuickFindContext.Provider>
  )
}

it.each(['pointer', 'touch'] as const)(
  'drops a choice when it shows again before it has closed, at %s density',
  async (density) => {
    const open = vi.fn()
    const launcher = { open }
    const Data = dataProviders({ db: openTestDb() })
    const controls: RefObject<QuickFindControls | null> = { current: null }
    renderWithProviders(
      <Data>
        <TuneFormLauncherContext.Provider value={launcher}>
          <ReopenedQuickFind controlsRef={controls} />
        </TuneFormLauncherContext.Provider>
      </Data>,
      { density },
    )
    await expect.poll(() => controls.current).not.toBeNull()
    controls.current!.showTwice()
    await command(NEW_TUNE_TITLE).click()
    await expect.poll(overlays).toBe(1)
    await expect.element(command(NEW_TUNE_TITLE)).toBeVisible()

    controls.current!.hide()
    await expect.element(quickFind()).not.toBeInTheDocument()
    await expect.poll(overlays).toBe(0)
    expect(open).not.toHaveBeenCalled()
  },
)
