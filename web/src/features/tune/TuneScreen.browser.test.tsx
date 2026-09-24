import { IonContent, IonPage, IonRouterOutlet } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import * as listsModule from '../../commands/lists'
import { addToList, createList } from '../../commands/lists'
import * as tunesModule from '../../commands/tunes'
import { createTune, deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import { DELETING } from '../../ui/Confirm'
import { MORE_ACTIONS } from '../../ui/Menu'
import { ADD_TO_LIST } from '../lists/ListPicker'
import { LARGER_TEXT } from '../lyrics/LyricsModal'
import { RecordProvider } from '../recording/useRecord'
import * as recordingsModule from '../recordings/useRecordings'
import type * as ConfirmModule from '../../ui/Confirm'
import type * as TunesModule from '../../commands/tunes'
import { EDIT_TUNE_TITLE } from './TuneFormSheet'
import { ADD_TO_LIST_TITLE, NOT_IN_LIST, OPEN_LYRICS, TUNE_GONE, TuneScreen } from './TuneScreen'

vi.mock('../../commands/tunes', { spy: true })
vi.mock('../../commands/lists', { spy: true })
vi.mock('../recordings/useRecordings', { spy: true })

let confirmCalls = 0
vi.mock('../../ui/Confirm', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfirmModule>()
  return {
    ...actual,
    useConfirm: () => {
      const confirm = actual.useConfirm()
      return (options: Parameters<typeof confirm>[0]) => {
        confirmCalls += 1
        return confirm(options)
      }
    },
  }
})

const { deleteTune: realDeleteTune } =
  await vi.importActual<typeof TunesModule>('../../commands/tunes')

/** A promise and the function that settles it, for holding a write in flight. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

let db: CrosstuneDb
let ids: { tuneId: string; userTuneId: string }

beforeEach(async () => {
  confirmCalls = 0
  db = openTestDb()
  ids = await createTune(
    db,
    {
      title: "Soldier's Joy",
      key: 'D',
      modes: ['major'],
      alternate_titles: ['Joy'],
      tunings: { violin: { tuning: 'Standard (GDAE)' } },
      is_crooked: true,
      genre: 'Old-time',
    },
    { status: 'learning', notes: 'Watch the B part.', learned_from: 'Jim' },
  )
})

afterEach(async () => {
  // Resets call counts and any one-off rejection a failed test left unconsumed; a spied module
  // falls back to its real implementation.
  vi.resetAllMocks()
  await db.delete()
})

/**
 * Mounts the tune page at its real route pattern, beside a catalog page, with no history behind
 * it. The shared renderScreen helper mounts at `*`, which leaves `tuneId` out of the params.
 */
function show(tuneId = ids.tuneId) {
  renderIonic(
    <IonReactMemoryRouter initialEntries={[`/catalog/${tuneId}`]}>
      {/* Inside the router, as the shell mounts it, so starting a recording can also navigate. */}
      <RecordProvider>
        <IonRouterOutlet>
          <Route
            path="/catalog"
            element={
              <IonPage>
                <IonContent>
                  <h1>Catalog probe</h1>
                </IonContent>
              </IonPage>
            }
          />
          <Route path="/catalog/:tuneId" element={<TuneScreen parent={() => '/catalog'} />} />
        </IonRouterOutlet>
      </RecordProvider>
    </IonReactMemoryRouter>,
    { db },
  )
}

const title = () => page.getByRole('heading', { name: "Soldier's Joy", level: 1 })

// Menu items render in a popover on a mouse; scoping to it keeps "Add to list" from matching the
// row of the same name on the page.
async function menuItem(label: string) {
  const popover = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-popover:not(.overlay-hidden)')
    if (!open) throw new Error('The menu is not open')
    return open
  })
  return page.elementLocator(popover).getByText(label, { exact: true })
}

// The alert opens while the menu's popover is still dismissing, so its button is scoped to it.
async function alertButton(label: string) {
  const alert = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
    if (!open) throw new Error('The confirmation is not open')
    return open
  })
  return page.elementLocator(alert).getByRole('button', { name: label, exact: true })
}

async function openMenuItem(label: string) {
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await (await menuItem(label)).click()
}

describe('TuneScreen', () => {
  it('shows the title, alternate titles, facets, and notes', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await expect.element(page.getByText('Joy', { exact: true })).toBeVisible()
    for (const facet of ['major', 'Learning', 'Violin: Standard (GDAE)', 'Crooked', 'Old-time']) {
      await expect.element(page.getByText(facet, { exact: true })).toBeVisible()
    }
    await expect.element(page.getByText('Learned from Jim')).toBeVisible()
    await expect.element(page.getByText('Watch the B part.')).toBeVisible()
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
  })

  it('holds every facet in one row under the title, the key first', async () => {
    show()
    await expect.element(title()).toBeVisible()
    const row = document.querySelector('[data-tune-facets]')!
    const pill = row.querySelector('.key-pill')!
    expect(pill.getAttribute('data-pitch')).toBe('2')
    expect(pill.textContent).toBe('D')
    // Every facet is a child of this one row, so none of them sits on a line of its own.
    expect(Array.from(row.children).map((child) => child.textContent)).toEqual([
      'D',
      'major',
      'Learning',
      'Violin: Standard (GDAE)',
      'Crooked',
      'Old-time',
    ])
  })

  it('sets its groups as cards on the grouped surface', async () => {
    show()
    await expect.element(title()).toBeVisible()
    const content = title().element().closest('ion-content')!
    expect(content.classList.contains('grouped')).toBe(true)
    await vi.waitFor(() => {
      expect(content.querySelector('ion-list')!.classList.contains('list-inset')).toBe(true)
    })
  })

  it('says when a tune was learned when only the date is set', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'known', learned_on: '2024-03-05' },
    )
    show(tuneId)
    await expect.element(page.getByText('Learned on Mar 5, 2024', { exact: true })).toBeVisible()
  })

  it('reads the learned line with both who and when', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'known', learned_from: 'Jim', learned_on: '2024-12-31' },
    )
    show(tuneId)
    await expect
      .element(page.getByText('Learned from Jim on Dec 31, 2024', { exact: true }))
      .toBeVisible()
  })

  it('shows two badges with the same text', async () => {
    const errors = vi.spyOn(console, 'error')
    const { tuneId } = await createTune(
      db,
      { title: 'Cluck Old Hen', genre: 'Crooked', is_crooked: true },
      { status: 'known' },
    )
    show(tuneId)
    await expect
      .element(page.getByRole('heading', { name: 'Cluck Old Hen', level: 1 }))
      .toBeVisible()
    expect(page.getByText('Crooked', { exact: true }).elements()).toHaveLength(2)
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
  })

  it('names the instrument on each tuning, so a shared tuning reads apart', async () => {
    const { tuneId } = await createTune(
      db,
      {
        title: 'Cluck Old Hen',
        tunings: { violin: { tuning: 'Cross A' }, five_string_banjo: { tuning: 'Cross A' } },
      },
      { status: 'known' },
    )
    show(tuneId)
    await expect.element(page.getByText('Violin: Cross A', { exact: true })).toBeVisible()
    await expect.element(page.getByText('5-string banjo: Cross A', { exact: true })).toBeVisible()
  })

  it('shows every tuning the tune holds, standard and capo included', async () => {
    const { tuneId } = await createTune(
      db,
      {
        title: 'Capo tune',
        tunings: {
          violin: { tuning: 'Standard (GDAE)' },
          guitar: { tuning: 'DADGAD', capo: 2 },
          mandolin: { capo: 3 },
        },
      },
      { status: 'known' },
    )
    show(tuneId)
    await expect.element(page.getByText('Violin: Standard (GDAE)', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Guitar: DADGAD, capo 2', { exact: true })).toBeVisible()
    await expect.element(page.getByText('Mandolin: Capo 3', { exact: true })).toBeVisible()
  })

  it('keeps a level 1 heading while the tune loads', async () => {
    vi.mocked(recordingsModule.useRecordingsWithFiles).mockReturnValue(undefined)
    show()
    await expect.element(page.getByRole('heading', { name: 'Tune', level: 1 })).toBeInTheDocument()
  })

  it('shows the recordings group above the lists group', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: ids.tuneId, label: 'Jam recording' }))
    show()
    await expect
      .element(page.getByRole('heading', { name: 'Jam recording', level: 3 }))
      .toBeVisible()
    expect(Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)).toEqual([
      'Recordings',
      'Lists',
      'Notes',
    ])
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
  })

  it('points Back at the parent', async () => {
    show()
    await expect.element(title()).toBeVisible()
    expect(document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('lists the lists the tune is in and removes it from one', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userTuneId)
    show()
    await expect.element(page.getByText('Tuesday jam')).toBeVisible()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText(NOT_IN_LIST)).toBeVisible()
  })

  it('removes from a list once when Remove is pressed twice', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userTuneId)
    show()
    const remove = page.getByRole('button', { name: 'Remove Tuesday jam' })
    await expect.element(remove).toBeVisible()
    const button = remove.element() as HTMLElement
    button.click()
    button.click()
    await expect.element(page.getByText(NOT_IN_LIST)).toBeVisible()
    expect(listsModule.removeFromList).toHaveBeenCalledTimes(1)
  })

  it('removes the same list item again after it is restored', async () => {
    const list = await createList(db, 'Tuesday jam')
    const itemId = await addToList(db, list, ids.userTuneId)
    show()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText(NOT_IN_LIST)).toBeVisible()
    await db.list_items.update(itemId, { deleted_at: null })
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByText(NOT_IN_LIST)).toBeVisible()
    expect(listsModule.removeFromList).toHaveBeenCalledTimes(2)
  })

  it('shows a failed removal', async () => {
    const list = await createList(db, 'Tuesday jam')
    await addToList(db, list, ids.userTuneId)
    vi.mocked(listsModule.removeFromList).mockRejectedValueOnce(new Error('Could not remove'))
    show()
    await page.getByRole('button', { name: 'Remove Tuesday jam' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not remove')
    await expect.element(page.getByText('Tuesday jam')).toBeVisible()
  })

  it('opens the list picker from Add to list', async () => {
    show()
    await page.getByRole('button', { name: ADD_TO_LIST }).first().click()
    await expect.element(page.getByText(ADD_TO_LIST_TITLE)).toBeVisible()
  })

  it('archives from the More actions menu', async () => {
    show()
    await openMenuItem('Archive')
    await vi.waitFor(async () =>
      expect((await db.user_tunes.get(ids.userTuneId))?.archived_at).not.toBeNull(),
    )
    await expect.element(page.getByText('Archived', { exact: true })).toBeVisible()
  })

  it('shows a failed archive', async () => {
    vi.mocked(tunesModule.setArchived).mockRejectedValueOnce(new Error('Could not archive'))
    show()
    await openMenuItem('Archive')
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not archive')
  })

  it('deletes only after the confirmation, with the consequence named', async () => {
    show()
    await openMenuItem('Delete')
    await expect
      .element(page.getByText('Delete "Soldier\'s Joy"? This removes its links and list entries.'))
      .toBeVisible()
    await (await alertButton('Cancel')).click()
    await vi.waitFor(() =>
      expect(document.querySelector('ion-alert:not(.overlay-hidden)')).toBeNull(),
    )
    expect((await db.tunes.get(ids.tuneId))?.deleted_at).toBeNull()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await vi.waitFor(async () =>
      expect((await db.tunes.get(ids.tuneId))?.deleted_at).not.toBeNull(),
    )
  })

  it('deletes once and goes back to the parent once, without saying the tune is gone', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await openMenuItem('Delete')
    const confirm = await alertButton('Delete')
    await expect.element(confirm).toBeVisible()
    const button = confirm.element() as HTMLElement
    button.click()
    button.click()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
    expect(tunesModule.deleteTune).toHaveBeenCalledTimes(1)
    expect(page.getByText(TUNE_GONE).elements()).toHaveLength(0)
  })

  it('asks once when the Delete menu item is pressed twice', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await page.getByRole('button', { name: MORE_ACTIONS }).click()
    const deleteItem = await menuItem('Delete')
    await expect.element(deleteItem).toBeVisible()
    const item = deleteItem.element() as HTMLElement
    item.click()
    item.click()
    await expect.element(await alertButton('Cancel')).toBeVisible()
    expect(confirmCalls).toBe(1)
  })

  it('shows that a slow delete is in progress', async () => {
    const write = gate()
    vi.mocked(tunesModule.deleteTune).mockImplementationOnce(async (...args) => {
      await write.opened
      return realDeleteTune(...args)
    })
    show()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await expect.element(page.getByText(DELETING)).toBeVisible()
    await expect.element(title()).toBeVisible()
    expect(page.getByRole('button', { name: MORE_ACTIONS }).elements()).toHaveLength(0)
    write.open()
    await expect.element(page.getByRole('heading', { name: 'Catalog probe' })).toBeVisible()
  })

  it('shows a failed delete and stays on the tune', async () => {
    vi.mocked(tunesModule.deleteTune).mockRejectedValueOnce(new Error('Could not delete'))
    show()
    await openMenuItem('Delete')
    await (await alertButton('Delete')).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not delete')
    await expect.element(title()).toBeVisible()
  })

  it('opens the form sheet from Edit', async () => {
    show()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect.element(page.getByText(EDIT_TUNE_TITLE)).toBeVisible()
  })

  it('says the tune is gone for an unknown id', async () => {
    show('missing')
    await expect.element(page.getByText(TUNE_GONE)).toBeVisible()
    expect(document.querySelector('ion-back-button')?.defaultHref).toBe('/catalog')
  })

  it('says the tune is gone when it is deleted elsewhere while open', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await deleteTune(db, ids.tuneId)
    await expect.element(page.getByText(TUNE_GONE)).toBeVisible()
  })

  it('offers no way to read lyrics for a tune with none', async () => {
    show()
    await expect.element(title()).toBeVisible()
    await expect.element(page.getByRole('button', { name: /^Open lyrics/ })).not.toBeInTheDocument()
  })

  it('offers no way to read lyrics for a body of whitespace', async () => {
    // Any writer but this client can store one: the API neither trims the body nor asks for a
    // length.
    const fresh = await createTune(
      db,
      { title: 'Uncle Joe', lyrics: '   \n  ' },
      { status: 'known' },
    )
    show(fresh.tuneId)
    await expect.element(page.getByRole('heading', { name: 'Uncle Joe' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /^Open lyrics/ })).not.toBeInTheDocument()
  })

  it('adds to a list from the header, with no row inside the card', async () => {
    show()
    await expect.element(title()).toBeVisible()
    // Ionic takes an aria-label off the host once it loads, so the control is found by role
    // inside the line that carries it.
    const headers = Array.from(document.querySelectorAll<HTMLElement>('[data-section-header]'))
    const lists = headers.find((line) => line.textContent?.startsWith('Lists'))!
    await expect
      .element(page.elementLocator(lists).getByRole('button', { name: ADD_TO_LIST }))
      .toBeVisible()
    expect(document.querySelector('ion-list[aria-label="Lists"]')).toBeNull()
    await expect.element(page.getByText(NOT_IN_LIST)).toBeVisible()
  })

  it('reads lyrics from a filled button rather than a row', async () => {
    const words = 'Did you ever go to meeting\nUncle Joe'
    const fresh = await createTune(db, { title: 'Uncle Joe', lyrics: words }, { status: 'known' })
    show(fresh.tuneId)
    const open = page.getByRole('button', { name: OPEN_LYRICS })
    await expect.element(open).toBeVisible()
    // A filled block button rather than a card row: the one bold control on the screen.
    const host = document.querySelector<HTMLElement>('ion-button[expand="block"]')!
    expect(host.textContent).toContain(OPEN_LYRICS)
    expect(Math.round(host.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
    expect(host.closest('ion-list')).toBeNull()
  })

  it('opens the reading view from the lyrics button', async () => {
    const words = 'Did you ever go to meeting\nUncle Joe'
    const fresh = await createTune(db, { title: 'Uncle Joe', lyrics: words }, { status: 'known' })
    show(fresh.tuneId)
    const open = page.getByRole('button', { name: OPEN_LYRICS })
    await expect.element(open).toBeVisible()
    // The words belong to the reading view, not to the tune screen, which shows none of them.
    await expect.element(page.getByText('Did you ever go to meeting')).not.toBeInTheDocument()
    await open.click()
    await expect.element(page.getByRole('button', { name: LARGER_TEXT })).toBeVisible()
  })
})
