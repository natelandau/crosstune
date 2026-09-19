import { IonContent, IonPage, IonRouterOutlet, useIonRouter } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { Route, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as bulkModule from '../../commands/bulk'
import { activeItems, createList } from '../../commands/lists'
import * as songsModule from '../../commands/songs'
import { createSong, setArchived } from '../../commands/songs'
import * as metaModule from '../../db/meta'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic, renderScreen } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { CatalogPage } from './CatalogPage'
import { META_CATALOG_FILTERS } from './filters'
import { readSearchQuery, writeSearchQuery } from './searchSession'
import * as catalogModule from './useCatalog'

vi.mock('../../commands/bulk', { spy: true })
vi.mock('../../commands/songs', { spy: true })
vi.mock('./useCatalog', { spy: true })
vi.mock('../../db/meta', { spy: true })

let db: CrosstuneDb
let joy: { songId: string; userSongId: string }
let hen: { songId: string; userSongId: string }

const originalMatchMedia = window.matchMedia

const storedStatus = async () =>
  (await getMeta<{ status: string } | null>(db, META_CATALOG_FILTERS, null))?.status

interface FilterWriteStep {
  /** Settles before the write's transaction opens. */
  before?: Promise<void>
  /** Rejects instead of writing, outside any transaction. */
  fail?: boolean
  /** Runs after the write's transaction commits, before the caller sees it settle. */
  after?: () => Promise<unknown>
}

/**
 * Steps the next filter writes around their transaction. Holding a write inside the
 * transaction would commit it early and fail it, so the hold wraps the transaction instead.
 */
function holdFilterWrites(steps: FilterWriteStep[]) {
  const real = db.transaction.bind(db) as (...args: unknown[]) => Promise<unknown>
  vi.spyOn(db, 'transaction').mockImplementation(((...args: unknown[]) => {
    const step = args[1] === db.meta ? steps.shift() : undefined
    if (!step) return real(...args)
    return (async () => {
      await step.before
      if (step.fail) throw new Error('Could not save')
      const result = await real(...args)
      await step.after?.()
      return result
    })()
  }) as unknown as typeof db.transaction)
}

/** A promise and the function that settles it, for holding a write in flight. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

beforeEach(async () => {
  db = openTestDb()
  joy = await createSong(
    db,
    { title: "Soldier's Joy", key: 'D', violin_tuning: 'Standard (GDAE)' },
    { status: 'known' },
  )
  hen = await createSong(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'learning' })
})

afterEach(async () => {
  window.matchMedia = originalMatchMedia
  vi.restoreAllMocks()
  await db.delete()
})

const show = () => renderScreen(<CatalogPage />, { db, path: '/catalog' })
const search = () => page.getByRole('searchbox', { name: 'Search songs' })
const row = (title: string) => page.getByRole('heading', { name: title })
const sheetOpen = () => document.querySelector('ion-modal:not(.overlay-hidden)')
const more = () => page.getByRole('button', { name: 'More actions' })
const menuItem = (name: string) => page.getByRole('button', { name })
const leaveSelection = () => page.getByRole('button', { name: 'Cancel selection' })
const rowCheckbox = (name: RegExp) => page.getByRole('checkbox', { name })
/** The toolbar title, which reads the count while selecting and the screen's name otherwise. */
const screenTitle = () => document.querySelector('ion-title')!.textContent?.trim()
/** An ion-button keeps its native button in a shadow root, which `closest` never leaves. */
function buttonHost(name: string): HTMLElement {
  const root = page.getByRole('button', { name }).element().getRootNode()
  return (root as ShadowRoot).host as HTMLElement
}
const archivedCount = async () =>
  (await db.user_songs.toArray()).filter((song) => song.archived_at !== null).length

/**
 * Ionic keeps a menu in the page while it dismisses and its focus trap holds the keyboard, so
 * anything typed before it is gone lands in the menu rather than on the screen.
 */
const menuClosed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-popover, ion-action-sheet')).toBeNull(), {
    timeout: 3000,
  })

async function startSelecting() {
  await more().click()
  await menuItem('Select').click()
  await expect.element(leaveSelection()).toBeVisible()
  await menuClosed()
}

/** Chooses an item in the selection toolbar's own overflow menu. */
async function pickFromMore(label: string) {
  await more().click()
  await menuItem(label).click()
  await menuClosed()
}

/** Opens an edit sheet row, named by its label and the value it currently reads. */
const openEditRow = (name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    .click()

const keyOf = async (songId: string) => (await db.songs.get(songId))?.key

/**
 * Holds the row at `index` until the mode opens, then lifts. The hold blocks the click it
 * leaves behind for a moment after the release, so the lift has to happen before the next tap.
 */
async function longPressRow(index: number) {
  const item = () => document.querySelectorAll('ion-item')[index]!
  item().dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }),
  )
  await vi.waitFor(() => expect(screenTitle()).toContain('selected'), { timeout: 3000 })
  // Entering selection replaces the row element, which releases the touch's implicit pointer
  // capture, so the lift lands on whatever row is there now.
  item().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true }))
  await new Promise((resolve) => setTimeout(resolve, 100))
}

/** Presses / and reports whether a shortcut claimed it. */
async function pressSlash(): Promise<boolean> {
  let prevented = false
  const probe = (event: KeyboardEvent) => {
    if (event.key === '/') prevented = event.defaultPrevented
  }
  window.addEventListener('keydown', probe)
  try {
    await userEvent.keyboard('/')
  } finally {
    window.removeEventListener('keydown', probe)
  }
  return prevented
}

function showInRouter() {
  renderIonic(
    <IonReactMemoryRouter initialEntries={['/catalog']}>
      <IonRouterOutlet>
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:songId" element={<SongProbe />} />
      </IonRouterOutlet>
    </IonReactMemoryRouter>,
    { db },
  )
}

function SongProbe() {
  const { songId } = useParams()
  const router = useIonRouter()
  return (
    <IonPage>
      <IonContent>
        <h1>Song {songId}</h1>
        <button type="button" onClick={() => router.goBack()}>
          Back
        </button>
      </IonContent>
    </IonPage>
  )
}

describe('CatalogPage', () => {
  it('keeps a level 1 heading named Catalog', async () => {
    show()
    await expect
      .element(page.getByRole('heading', { name: 'Catalog', level: 1 }))
      .toBeInTheDocument()
  })

  it('lists songs and narrows them by search text', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await search().fill('cluck')
    await expect.poll(() => row("Soldier's Joy").elements().length).toBe(0)
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    expect(readSearchQuery()).toBe('cluck')
  })

  it('persists a status filter in the meta table, not the session query', async () => {
    show()
    // ion-segment-button exposes role `tab`, and Ionic makes the inner button ignore clicks.
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await expect
      .poll(
        async () =>
          (await getMeta<{ status: string } | null>(db, META_CATALOG_FILTERS, null))?.status,
      )
      .toBe('known')
    await expect.poll(() => row('Cluck Old Hen').elements().length).toBe(0)
    expect(readSearchQuery()).toBe('')
  })

  it('writes the status filter once per tap and shows it while the write is in flight', async () => {
    const warn = vi.spyOn(console, 'warn')
    const write = gate()
    holdFilterWrites([{ before: write.opened }])
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    const known = page.getByRole('tab', { name: 'Known' })
    await known.click({ force: true })
    await expect.element(known).toHaveAttribute('aria-selected', 'true')
    // A song arriving mid-write re-renders the filters with the stored status.
    await createSong(db, { title: 'Angeline the Baker' }, { status: 'known' })
    await expect.element(row('Angeline the Baker')).toBeVisible()
    expect(known.element().getAttribute('aria-selected')).toBe('true')
    write.open()
    await expect.poll(async () => storedStatus()).toBe('known')
    await expect.poll(() => row('Cluck Old Hen').elements().length).toBe(0)
    await expect.element(known).toHaveAttribute('aria-selected', 'true')
    const filterWrites = vi
      .mocked(metaModule.setMeta)
      .mock.calls.filter(([, key]) => key === META_CATALOG_FILTERS)
    expect(filterWrites).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('shows the stored status filter again and says so when its write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = gate()
    holdFilterWrites([{ before: write.opened, fail: true }])
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    const known = page.getByRole('tab', { name: 'Known' })
    await known.click({ force: true })
    await expect.element(known).toHaveAttribute('aria-selected', 'true')
    write.open()
    await expect
      .element(page.getByRole('tab', { name: 'All' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('The filters could not be saved.')
    await page.getByRole('tab', { name: 'Learning' }).click({ force: true })
    await expect.poll(async () => storedStatus()).toBe('learning')
    await expect.poll(() => page.getByRole('alert').elements().length).toBe(0)
  })

  it('keeps a later status filter showing when an earlier write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = gate()
    const second = gate()
    holdFilterWrites([{ before: first.opened, fail: true }, { before: second.opened }])
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    const learning = page.getByRole('tab', { name: 'Learning' })
    await learning.click({ force: true })
    await expect.element(learning).toHaveAttribute('aria-selected', 'true')
    first.open()
    await expect.element(page.getByRole('alert')).toBeVisible()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(learning.element().getAttribute('aria-selected')).toBe('true')
    expect(warn).toHaveBeenCalledTimes(1)
    second.open()
    await expect.poll(async () => storedStatus()).toBe('learning')
    await expect.poll(() => page.getByRole('alert').elements().length).toBe(0)
    await expect.element(learning).toHaveAttribute('aria-selected', 'true')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('follows a status filter another tab writes after a local write lands', async () => {
    holdFilterWrites([
      {
        // Runs after this page's write commits, outside its transaction, before the page
        // learns the write has settled.
        after: () => db.meta.put({ key: META_CATALOG_FILTERS, value: { status: 'learning' } }),
      },
    ])
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    const learning = page.getByRole('tab', { name: 'Learning' })
    await expect.element(learning).toHaveAttribute('aria-selected', 'true')
    const known = page.getByRole('tab', { name: 'Known' })
    await known.click({ force: true })
    await expect.poll(async () => storedStatus()).toBe('known')
    await expect.element(known).toHaveAttribute('aria-selected', 'true')
  })

  it('shows a filter error and an archive error together and clears each on its own', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The failure waits for the tap to finish, as a real IndexedDB failure does.
    const write = gate()
    holdFilterWrites([{ before: write.opened, fail: true }])
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await expect
      .element(page.getByRole('tab', { name: 'Known' }))
      .toHaveAttribute('aria-selected', 'true')
    write.open()
    const filterError = page.getByText('The filters could not be saved.')
    await expect.element(filterError).toBeVisible()
    vi.mocked(songsModule.setArchived).mockRejectedValueOnce(new Error('Song not found'))
    await userEvent.hover(document.querySelector('[data-row-open]')!)
    await page.getByRole('button', { name: "Archive Soldier's Joy" }).click()
    const archiveError = page.getByText('Song not found')
    await expect.element(archiveError).toBeVisible()
    await expect.element(filterError).toBeVisible()
    expect(page.getByRole('alert').elements()).toHaveLength(2)
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await expect.poll(async () => storedStatus()).toBe('known')
    await expect.poll(() => filterError.elements().length).toBe(0)
    await expect.element(archiveError).toBeVisible()
    await page.getByRole('button', { name: "Archive Soldier's Joy" }).click()
    await expect
      .poll(async () => (await db.user_songs.get(joy.userSongId))?.archived_at)
      .not.toBeNull()
    await expect.poll(() => page.getByRole('alert').elements().length).toBe(0)
  })

  it('forgets a hidden facet on every filter write', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { banjo_tuning: 'Open G (gDGBD)' })
    show()
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await expect
      .poll(async () => getMeta<Record<string, unknown> | null>(db, META_CATALOG_FILTERS, null))
      .toMatchObject({ status: 'known', banjo_tuning: 'all' })
  })

  it('announces the count when filters change but not while typing', async () => {
    show()
    await expect.element(page.getByText('2 songs')).toBeVisible()
    const live = () => document.querySelector('ion-content [aria-live="polite"]')!.textContent
    await search().fill('cluck')
    await expect.element(page.getByText('1 of 2 songs')).toBeVisible()
    expect(live()).toBe('')
    await search().fill('')
    await page.getByRole('tab', { name: 'Learning' }).click({ force: true })
    await expect.poll(live).toBe('1 of 2 songs')
    await search().fill('zzz')
    await expect.element(page.getByText('0 of 2 songs')).toBeVisible()
    expect(live()).toBe('1 of 2 songs')
  })

  it('does nothing on Enter before the catalog has loaded', async () => {
    const actual = await vi.importActual<typeof catalogModule>('./useCatalog')
    vi.mocked(catalogModule.useCatalog).mockImplementation(() => undefined)
    try {
      show()
      await search().fill('Sally Goodin')
      await userEvent.keyboard('{Enter}')
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(readSearchQuery()).toBe('Sally Goodin')
      expect(sheetOpen()).toBeNull()
    } finally {
      vi.mocked(catalogModule.useCatalog).mockImplementation(actual.useCatalog)
    }
  })

  it('shows the count under the list and keeps it while every song is archived', async () => {
    show()
    await expect.element(page.getByText('2 songs')).toBeVisible()
    for (const song of await db.user_songs.toArray()) await setArchived(db, song.id, true)
    // The live region repeats the count after the stored songs change; the footnote comes first.
    await expect.element(page.getByText('0 songs').first()).toBeVisible()
  })

  it('offers to add the query under partial matches and another song for an exact title', async () => {
    show()
    await search().fill('soldier')
    await expect.element(page.getByRole('button', { name: 'Add "soldier"' })).toBeVisible()
    await search().fill("Soldier's Joy")
    await expect
      .element(page.getByRole('button', { name: 'Add another "Soldier\'s Joy"' }))
      .toBeVisible()
  })

  it('points to an archived exact match and opens it', async () => {
    await setArchived(db, joy.userSongId, true)
    showInRouter()
    await search().fill("soldier's joy")
    await expect.element(page.getByText('"Soldier\'s Joy" is archived.')).toBeVisible()
    const open = page.getByRole('link', { name: "Open Soldier's Joy" })
    await expect.element(open).toBeVisible()
    const target = open.element().getBoundingClientRect()
    expect(target.height).toBeGreaterThanOrEqual(44)
    expect(target.width).toBeGreaterThanOrEqual(44)
    // The larger target must not push the sentence onto a taller line.
    expect(open.element().closest('p')!.getBoundingClientRect().height).toBeLessThan(44)
    await open.click()
    await expect
      .element(page.getByRole('heading', { name: `Song ${joy.songId}`, level: 1 }))
      .toBeVisible()
  })

  it('points to an exact match a filter hides', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { status: 'learning' })
    show()
    await search().fill("Soldier's Joy")
    await expect
      .element(page.getByText('"Soldier\'s Joy" is hidden by your filters.'))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Add another "Soldier\'s Joy"' }))
      .toBeVisible()
  })

  it('keeps the filters when the search is cleared', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { status: 'learning' })
    show()
    await search().fill('cluck')
    await search().fill('')
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    expect(row("Soldier's Joy").elements()).toHaveLength(0)
    expect((await getMeta<{ status: string } | null>(db, META_CATALOG_FILTERS, null))?.status).toBe(
      'learning',
    )
  })

  it('opens the filter sheet and names how many filters are set', async () => {
    await db.songs.update(joy.songId, { genre: 'Old-time' })
    await setMeta(db, META_CATALOG_FILTERS, { genre: 'Old-time', archived: true })
    show()
    await expect.element(page.getByRole('button', { name: 'Remove filter Old-time' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Remove filter Archived shown' }))
      .toBeVisible()
    await page.getByRole('button', { name: 'Filters, 2 set' }).click()
    await expect.element(page.getByText('Show archived')).toBeVisible()
  })

  it('names the empty states', async () => {
    show()
    await search().fill('zzz')
    await expect.element(page.getByText('No song called "zzz"')).toBeVisible()
  })

  it('offers More actions only when there is a song to select', async () => {
    show()
    await expect.element(more()).toBeVisible()
    await search().fill('zzz')
    await expect.element(more()).not.toBeInTheDocument()
  })

  it('invites the first song when the catalog is empty', async () => {
    await db.user_songs.clear()
    await db.songs.clear()
    show()
    await expect.element(page.getByText('No songs yet')).toBeVisible()
    await expect.element(page.getByText('Add the first song you know.')).toBeVisible()
    expect(page.getByText(/\d+ songs?$/).elements()).toHaveLength(0)
  })

  it('opens the new song form with the query as its title from Enter and clears the search', async () => {
    show()
    await search().fill('Sally Goodin')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByText('New song')).toBeVisible()
    await expect.element(page.getByLabelText('Title')).toHaveValue('Sally Goodin')
    expect(readSearchQuery()).toBe('')
  })

  it('does not act on Enter while an input method is composing', async () => {
    show()
    await search().fill('Sally Goodin')
    search()
      .element()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
      )
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(sheetOpen()).toBeNull()
    expect(readSearchQuery()).toBe('Sally Goodin')
  })

  it('clears the query and the session from the clear button, keeping the filters', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { status: 'learning' })
    show()
    await search().fill('cluck')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.element(search()).toHaveValue('')
    expect(readSearchQuery()).toBe('')
    expect((await getMeta<{ status: string } | null>(db, META_CATALOG_FILTERS, null))?.status).toBe(
      'learning',
    )
  })

  it('opens the only visible song from Enter', async () => {
    showInRouter()
    await search().fill('soldier')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(page.getByRole('heading', { name: `Song ${joy.songId}`, level: 1 }))
      .toBeVisible()
  })

  it('opens the form from Add song in the toolbar', async () => {
    show()
    await page.getByRole('button', { name: 'Add song' }).click()
    await expect.element(page.getByText('New song')).toBeVisible()
  })

  it('opens a new song after saving it and leaves no sheet open', async () => {
    showInRouter()
    await page.getByRole('button', { name: 'Add song' }).click()
    await expect.element(page.getByText('New song')).toBeVisible()
    await page.getByLabelText('Title').fill('Sally Goodin')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.poll(() => db.songs.where('title').equals('Sally Goodin').count()).toBe(1)
    const created = (await db.songs.where('title').equals('Sally Goodin').first())!
    await expect
      .element(page.getByRole('heading', { name: `Song ${created.id}`, level: 1 }))
      .toBeVisible()
    await vi.waitFor(() => expect(sheetOpen()).toBeNull())
  })

  it('archives from a row and reports a failure above the list', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await userEvent.hover(document.querySelector('[data-row-open]')!)
    await page.getByRole('button', { name: "Archive Soldier's Joy" }).click()
    await expect
      .poll(async () => (await db.user_songs.get(joy.userSongId))?.archived_at)
      .not.toBeNull()
    vi.mocked(songsModule.setArchived).mockRejectedValueOnce(new Error('Song not found'))
    await page.getByRole('button', { name: 'Archive Cluck Old Hen' }).click()
    const alert = page.getByRole('alert')
    await expect.element(alert).toHaveTextContent('Song not found')
    const list = document.querySelector('ion-list')!
    expect(
      alert.element().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('unarchives an archived row', async () => {
    await setArchived(db, joy.userSongId, true)
    await setMeta(db, META_CATALOG_FILTERS, { archived: true })
    show()
    await page.getByRole('button', { name: "Unarchive Soldier's Joy" }).click()
    await expect.poll(async () => (await db.user_songs.get(joy.userSongId))?.archived_at).toBeNull()
  })

  it('edits a song from its row in the form sheet', async () => {
    show()
    await page.getByRole('button', { name: "Edit Soldier's Joy" }).click()
    await expect.element(page.getByText('Edit song')).toBeVisible()
    await expect.element(page.getByLabelText('Title')).toHaveValue("Soldier's Joy")
  })

  it('restores the session query and ignores one left in the meta table', async () => {
    writeSearchQuery('cluck')
    await setMeta(db, META_CATALOG_FILTERS, { query: 'soldier' })
    show()
    await expect.element(search()).toHaveValue('cluck')
    await expect.poll(() => row("Soldier's Joy").elements().length).toBe(0)
  })

  it('does not let a hidden facet narrow the catalog', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { banjo_tuning: 'Open G (gDGBD)' })
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await expect.element(row('Cluck Old Hen')).toBeVisible()
  })

  it('focuses search with / on a mouse', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    expect(await pressSlash()).toBe(true)
    await vi.waitFor(() => expect(document.activeElement?.closest('ion-searchbar')).not.toBeNull())
  })

  it('ignores / while the form sheet is open', async () => {
    show()
    await page.getByRole('button', { name: 'Add song' }).click()
    await expect.element(page.getByText('New song')).toBeVisible()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(await pressSlash()).toBe(false)
    expect(document.activeElement?.closest('ion-searchbar')).toBeNull()
  })

  it('leaves / alone once another page is pushed over the catalog, and takes it back after', async () => {
    showInRouter()
    await search().fill('soldier')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(page.getByRole('heading', { name: `Song ${joy.songId}`, level: 1 }))
      .toBeVisible()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(await pressSlash()).toBe(false)
    expect(document.activeElement?.closest('ion-searchbar')).toBeNull()

    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect
      .element(page.getByRole('heading', { name: `Song ${joy.songId}`, level: 1 }))
      .not.toBeInTheDocument()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(await pressSlash()).toBe(true)
    await vi.waitFor(() => expect(document.activeElement?.closest('ion-searchbar')).not.toBeNull())
  })

  it('ignores / on touch', async () => {
    forceTouch()
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    expect(await pressSlash()).toBe(false)
    expect(document.activeElement?.closest('ion-searchbar')).toBeNull()
  })

  it('walks the rows with the arrow keys on a mouse', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    const opens = document.querySelectorAll<HTMLElement>('[data-row-open]')
    opens[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(opens[1])
  })

  it('syncs when pulled to refresh on touch', async () => {
    forceTouch()
    const sync = vi.fn(async () => {})
    renderScreen(<CatalogPage />, { db, path: '/catalog', engine: fakeEngine({ sync }) })
    await expect.element(row("Soldier's Joy")).toBeVisible()
    const refresher = document.querySelector('ion-refresher')!
    expect(refresher.parentElement?.tagName).toBe('ION-CONTENT')
    const complete = vi.fn()
    refresher.dispatchEvent(new CustomEvent('ionRefresh', { detail: { complete } }))
    expect(sync).toHaveBeenCalledOnce()
    await expect.poll(() => complete.mock.calls.length).toBe(1)
  })

  it('offers no pull to refresh on a mouse', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    expect(document.querySelector('ion-refresher')).toBeNull()
  })
})

describe('CatalogPage selection', () => {
  it('gives every toolbar control a 44px tap target', async () => {
    show()
    await expect.element(page.getByRole('button', { name: 'More actions' })).toBeVisible()
    for (const name of ['Filters', 'Add song', 'More actions']) {
      const box = buttonHost(name).getBoundingClientRect()
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  })

  it('keeps every toolbar control at 44px on a 320px screen, gated or not', async () => {
    await page.viewport(320, 640)
    try {
      show()
      await expect.element(more()).toBeVisible()
      for (const name of ['Filters', 'Add song', 'More actions']) {
        const box = buttonHost(name).getBoundingClientRect()
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.width, name).toBeGreaterThanOrEqual(44)
      }
      await search().fill('zzz')
      await expect.element(more()).not.toBeInTheDocument()
      for (const name of ['Filters', 'Add song']) {
        const box = buttonHost(name).getBoundingClientRect()
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.width, name).toBeGreaterThanOrEqual(44)
      }
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('names each toolbar control again after the mode ends', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await expect.element(page.getByRole('button', { name: 'Status' })).toBeVisible()
    await leaveSelection().click()
    for (const name of ['Filters', 'Add song', 'More actions']) {
      await expect.element(page.getByRole('button', { name })).toBeVisible()
    }
    expect(page.getByRole('button', { name: 'Status' }).elements()).toHaveLength(0)
  })

  it('enters selection from the More menu and leaves from the toolbar', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await expect.poll(screenTitle).toBe('0 selected')
    await leaveSelection().click()
    await expect.poll(screenTitle).toBe('Catalog')
    await expect.element(page.getByRole('button', { name: 'Add song' })).toBeVisible()
  })

  it('enters from a long press with that row selected', async () => {
    forceTouch()
    show()
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    await longPressRow(0)
    await expect.element(rowCheckbox(/^Deselect Cluck Old Hen/)).toBeChecked()
    expect(screenTitle()).toBe('1 selected')
  })

  it('releases the click guard, so the next tap selects a second row', async () => {
    forceTouch()
    show()
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    await longPressRow(0)
    expect(screenTitle()).toBe('1 selected')
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('2 selected')
  })

  it('toggles rows and counts them', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('2 selected')
    await rowCheckbox(/^Deselect Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('1 selected')
  })

  it('selects and deselects every visible song', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('2 selected')
    await pickFromMore('Deselect all')
    await expect.poll(screenTitle).toBe('0 selected')
  })

  it('extends a range with shift-click', async () => {
    await createSong(db, { title: 'Angeline the Baker' }, { status: 'known' })
    show()
    await expect.element(row('Angeline the Baker')).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Angeline the Baker/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await rowCheckbox(/^Select Soldier's Joy/).click({ modifiers: ['Shift'] })
    await expect.poll(screenTitle).toBe('3 selected')
  })

  it('selects all with Ctrl-A', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await userEvent.keyboard('{Control>}a{/Control}')
    await expect.poll(screenTitle).toBe('2 selected')
  })

  it('drops songs a filter hides from the selection', async () => {
    await createSong(db, { title: 'Angeline the Baker' }, { status: 'known' })
    show()
    await expect.element(row('Angeline the Baker')).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('3 selected')
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await expect.poll(screenTitle).toBe('2 selected')
  })

  it('drops songs the search hides from the selection', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('2 selected')
    await search().fill('cluck')
    await expect.poll(screenTitle).toBe('1 selected')
  })

  it('stops offering the rows as links while selecting', async () => {
    show()
    const open = page.getByRole('button', { name: /^Soldier's Joy/ })
    await expect.element(open).toBeVisible()
    await startSelecting()
    await expect.poll(() => open.elements().length).toBe(0)
    await expect.element(rowCheckbox(/^Select Soldier's Joy/)).toBeVisible()
    await leaveSelection().click()
    await expect.element(open).toBeVisible()
  })

  it('hides Add song and Filters while selecting', async () => {
    show()
    const add = page.getByRole('button', { name: 'Add song' })
    const filters = page.getByRole('button', { name: 'Filters' })
    await expect.element(add).toBeVisible()
    await expect.element(filters).toBeVisible()
    await startSelecting()
    await expect.poll(() => add.elements().length).toBe(0)
    await expect.poll(() => filters.elements().length).toBe(0)
    await leaveSelection().click()
    await expect.element(add).toBeVisible()
    await expect.element(filters).toBeVisible()
  })

  it('offers no add or open suggestion under the search while selecting', async () => {
    show()
    await search().fill('soldier')
    const offer = page.getByRole('button', { name: 'Add "soldier"' })
    await expect.element(offer).toBeVisible()
    await startSelecting()
    await expect.poll(() => offer.elements().length).toBe(0)
    await leaveSelection().click()
    await expect.element(offer).toBeVisible()

    // Entered before the archive, since afterward Soldier's Joy is the only match and
    // archiving it takes the More actions button that opens this mode with it.
    await startSelecting()
    await setArchived(db, joy.userSongId, true)
    await search().fill("Soldier's Joy")
    const hidden = page.getByRole('link', { name: "Open Soldier's Joy" })
    await expect.poll(() => hidden.elements().length).toBe(0)
    await leaveSelection().click()
    await expect.element(hidden).toBeVisible()
  })

  it('stays on the catalog when Enter is pressed in the search box while selecting', async () => {
    showInRouter()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await search().fill('soldier')
    await expect.poll(screenTitle).toBe('1 selected')
    await userEvent.keyboard('{Enter}')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(
      page.getByRole('heading', { name: `Song ${joy.songId}`, level: 1 }).elements(),
    ).toHaveLength(0)
    expect(screenTitle()).toBe('1 selected')
    await expect.element(leaveSelection()).toBeVisible()
  })

  it('keeps the mode when Escape fires from the search box, and clears the query', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await search().fill('soldier')
    await expect.element(search()).toHaveValue('soldier')
    await userEvent.keyboard('{Escape}')
    await expect.element(search()).toHaveValue('')
    await expect.element(leaveSelection()).toBeVisible()
    expect(readSearchQuery()).toBe('')
  })

  it('sets the status of a selection from the toolbar', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await page.getByRole('button', { name: 'Status' }).click()
    await menuItem('Learning').click()
    await expect
      .poll(async () => (await db.user_songs.get(joy.userSongId))?.status)
      .toBe('learning')
    await expect.poll(screenTitle).toBe('Catalog')
    await expect.element(page.getByText('Set 1 song to Learning')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await db.user_songs.get(joy.userSongId))?.status).toBe('known')
  })

  it('keeps the mode and reports a failed bulk write above the list', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Soldier's Joy/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    vi.mocked(bulkModule.updateSongs).mockRejectedValueOnce(new Error('Song not found'))
    await page.getByRole('button', { name: 'Status' }).click()
    await menuItem('Learning').click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Song not found')
    expect(screenTitle()).toBe('1 selected')
  })

  it('archives a selection from the More menu and undoes', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('2 selected')
    await pickFromMore('Archive 2 songs')
    await expect.poll(archivedCount).toBe(2)
    await expect.poll(screenTitle).toBe('Catalog')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(archivedCount).toBe(0)
  })

  it('leaves focus on a real control after a bulk action from the More menu', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await pickFromMore('Archive 1 song')
    await expect.poll(archivedCount).toBe(1)
    await expect.poll(screenTitle).toBe('Catalog')
    // The menu holds the keyboard until it has finished dismissing and then hands focus back to
    // a control the action took away, so the mode's own restore has to outlast it.
    await vi.waitFor(() => expect(document.activeElement).toBe(buttonHost('More actions')), {
      timeout: 3000,
    })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(archivedCount).toBe(0)
  })

  it('moves focus to the page after every visible song is archived from the More menu', async () => {
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await pickFromMore('Select all')
    await expect.poll(screenTitle).toBe('2 selected')
    await pickFromMore('Archive 2 songs')
    await expect.poll(archivedCount).toBe(2)
    await expect.poll(screenTitle).toBe('Catalog')
    // Archiving every visible song takes the More actions button down with the list, so focus
    // falls back to the screen's own landmark rather than a control that no longer exists.
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('main')), {
      timeout: 3000,
    })
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(archivedCount).toBe(0)
  })

  it('edits a selection through the edit sheet and undoes', async () => {
    show()
    await expect.element(row('Cluck Old Hen')).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect.element(page.getByText('Edit 1 song')).toBeVisible()
    await openEditRow('Key, A')
    await page.getByRole('radio', { name: 'G', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => keyOf(hen.songId)).toBe('G')
    expect(await keyOf(joy.songId)).toBe('D')
    await expect.poll(screenTitle).toBe('Catalog')
    await expect.element(page.getByText('Edited 1 song')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => keyOf(hen.songId)).toBe('A')
  })

  it('adds a selection to a list', async () => {
    const listId = await createList(db, 'Tuesday jam')
    show()
    await expect.element(row("Soldier's Joy")).toBeVisible()
    await startSelecting()
    await rowCheckbox(/^Select Cluck Old Hen/).click()
    await expect.poll(screenTitle).toBe('1 selected')
    await page.getByRole('button', { name: 'Add to list' }).click()
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await expect.poll(async () => (await activeItems(db, listId)).length).toBe(1)
    await expect.poll(screenTitle).toBe('Catalog')
    await expect.element(page.getByText('Added 1 song to Tuesday jam')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await activeItems(db, listId)).length).toBe(0)
  })
})
