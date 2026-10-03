import { IonContent, IonPage } from '@ionic/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addLink } from '../../commands/links'
import { updateRecording } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { menuItem } from '../../test/dialogs'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { renderScreen } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import type { Provider } from '../../api/vocabulary'
import { toggleSearchProvider } from '../../commands/settings'
import type { SyncEngine } from '../../sync/types'
import { fakeEngine } from '../../test/providers'
import {
  FIND_RECORDINGS,
  SEARCH_FAILED,
  SEARCH_NEEDS_CONNECTION,
  searchService,
} from '../links/findRecordingsCopy'
import { deviceCountry } from '../links/region'
import { SEARCHABLE_PROVIDERS } from '../settings/searchProviders'
import { ADD_LINK, PASTE_LINK } from '../links/PasteLinkSheet'
import { NEW_RECORDING } from '../recording/RecordModal'
import type * as RecordModule from '../recording/useRecord'
import { RecordProvider } from '../recording/useRecord'
import { RECORDING_NAME_LABEL, RENAME } from '../recordings/recordingCopy'
import { DELETE_SYNCED_NOTE } from '../recordings/recordingRow'
import { RENAME_RECORDING_TITLE } from '../recordings/RenameRecordingSheet'
import { DELETE_RECORDING_TITLE } from '../recordings/useRecordingActions'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import { ADD_RECORDING, NO_MEDIA_HINT, NO_MEDIA_TITLE, TuneMedia } from './TuneMedia'
import { useTune } from './useTune'

vi.mock('../../commands/recordings', { spy: true })
vi.mock('../../commands/links', { spy: true })

let starts: (string | undefined)[] = []
vi.mock('../recording/useRecord', async (importOriginal) => {
  const actual = await importOriginal<typeof RecordModule>()
  return {
    ...actual,
    useRecord: () => {
      const record = actual.useRecord()
      return {
        start: (tuneId?: string) => {
          starts.push(tuneId)
          record.start(tuneId)
        },
      }
    },
  }
})

let db: CrosstuneDb
let tuneId: string
let restore: (() => void) | null = null

/** The microphone globals a record modal touches; the afterEach below puts each one back. */
function fakeMedia() {
  const owned = (['mediaDevices', 'storage'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
  )
  stubMediaGlobals()
  restore = () => {
    for (const [key, descriptor] of owned) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor)
      else Reflect.deleteProperty(navigator, key)
    }
  }
}

beforeEach(async () => {
  starts = []
  db = openTestDb()
  ;({ tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'learning' }))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  restore?.()
  restore = null
  vi.resetAllMocks()
})

/** Reads this tune's rows and hands them down, the way the tune screen mounts the section. */
function Host() {
  const view = useTune(tuneId)
  const recordings = useRecordingsWithFiles({ tuneId })
  if (!view || !recordings) return null
  return <TuneMedia tuneId={tuneId} recordings={recordings} links={view.links} />
}

function show(engine?: SyncEngine) {
  renderScreen(
    <IonPage>
      <IonContent>
        <RecordProvider>
          <Host />
        </RecordProvider>
      </IonContent>
    </IonPage>,
    { db, engine, path: `/catalog/${tuneId}`, route: '/catalog/:tuneId' },
  )
}

async function onlyChoose(chosen: Provider) {
  for (const provider of SEARCHABLE_PROVIDERS) {
    if (provider !== chosen) await toggleSearchProvider(db, 'user_1', provider, false)
  }
}

const youtube = {
  url: 'https://youtu.be/dQw4w9WgXcQ',
  provider: 'youtube' as const,
  provider_ref: 'dQw4w9WgXcQ',
}

/**
 * Dismisses the Add recording menu if it is still up and opens it again. The menu opens only
 * once the one before it has dismissed and run its chosen item, so once it is back, whatever
 * the earlier tap set off has run.
 */
async function reopenMenu() {
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull()
  await page.getByRole('button', { name: ADD_RECORDING }).click()
  await expect.element(await menuItem(PASTE_LINK)).toBeVisible()
}

const sectionHeaders = () => Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)
const rowTitles = () => Array.from(document.querySelectorAll('h3')).map((h) => h.textContent)

describe('TuneMedia', () => {
  it('names the empty state and the one way into adding a recording', async () => {
    show()
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
    const control = page.getByRole('button', { name: ADD_RECORDING, exact: true })
    await expect.element(control).toBeVisible()
    const host = (control.element().getRootNode() as ShadowRoot).host
    await expect.poll(() => host.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    // A glyph out of the accessibility tree, since the control's own name says what it does.
    const glyph = () => host.querySelector('svg')
    await expect.poll(glyph, { message: 'Add recording carries no glyph' }).not.toBeNull()
    await expect.poll(() => glyph()?.getAttribute('aria-hidden')).toBe('true')
  })

  it('titles an unlabeled recording by its date rather than repeating the page title', async () => {
    // The tune page's own title already names the tune, so the row falls to its date instead.
    await db.recordings.put(
      recordingRow('r1', { tune_id: tuneId, label: null, recorded_at: '2026-03-14T20:05:00.000Z' }),
    )
    show()
    // The browser project runs in the machine's own zone, so the date itself is not asserted.
    const row = page.getByRole('heading', { name: 'Recording, ', exact: false, level: 3 })
    await expect.element(row).toBeVisible()
    expect(row.element().textContent).not.toContain("Soldier's Joy")
    await expect.poll(sectionHeaders).toEqual(['Recordings'])
  })

  it('opens the record modal for this tune', async () => {
    fakeMedia()
    show()
    await page.getByRole('button', { name: ADD_RECORDING, exact: true }).click()
    await (await menuItem(NEW_RECORDING)).click()
    await expect.element(page.getByRole('dialog', { name: NEW_RECORDING })).toBeInTheDocument()
    await expect.poll(() => starts).toEqual([tuneId])
  })

  it('adds a pasted link as a row of its own', async () => {
    show()
    await page.getByRole('button', { name: ADD_RECORDING, exact: true }).click()
    await (await menuItem(PASTE_LINK)).click()
    await expect.element(page.getByLabelText('Link')).toBeVisible()
    await page.getByLabelText('Link').fill(youtube.url)
    await page.getByRole('button', { name: ADD_LINK, exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    await expect.element(page.getByRole('heading', { name: 'youtu.be', level: 3 })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Open youtu.be on YouTube' })).toBeVisible()
  })

  it('holds recordings and links in one list, recordings first', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    await addLink(db, tuneId, { ...youtube, title: 'Slow version' })
    show()
    await expect.element(page.getByRole('heading', { name: 'Slow version' })).toBeVisible()
    await expect.poll(sectionHeaders).toEqual(['Recordings'])
    await expect.poll(rowTitles).toEqual(['Jam recording', 'Slow version'])
    const list = page.getByRole('list', { name: 'Recordings' })
    await expect.element(list.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await expect.element(list.getByRole('heading', { name: 'Slow version' })).toBeVisible()
  })

  it("sits a link's provider line where a recording's metadata sits", async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    await addLink(db, tuneId, { ...youtube, title: 'Slow version' })
    show()
    await expect.element(page.getByRole('heading', { name: 'Slow version' })).toBeVisible()
    const row = (title: string) =>
      Array.from(document.querySelectorAll('ion-item')).find(
        (item) => item.querySelector('h3')?.textContent === title,
      )!
    const gap = (item: Element, second: Element) =>
      second.getBoundingClientRect().top - item.querySelector('h3')!.getBoundingClientRect().bottom
    await vi.waitFor(() => {
      const recording = row('Jam recording')
      const link = row('Slow version')
      const below = gap(recording, recording.querySelector('p.type-subheadline')!)
      const under = gap(link, link.querySelector('.row-note a')!)
      // A pixel of slack covers the rounding a line box takes at a text size the setting moves.
      expect(
        Math.abs(under - below),
        `link ${under} against recording ${below}`,
      ).toBeLessThanOrEqual(1)
    })
  })

  it('unfiles a recording from its own row', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove from tune Jam recording' }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.tune_id).toBeNull())
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
  })

  it('reports a refused row action on one line under the groups', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The tune would not let go.'))
    await page.getByRole('button', { name: 'Remove from tune Jam recording' }).click()
    const line = page.getByRole('alert')
    await expect.element(line).toHaveTextContent('The tune would not let go.')
    expect(line.element().closest('ion-item')).toBeNull()
    // It sits under the cards, so it lines up with their text rather than starting short of it.
    const header = document.querySelector('[data-section-header]')!
    await expect
      .poll(
        () =>
          Number.parseFloat(getComputedStyle(line.element()).paddingLeft) -
          Number.parseFloat(getComputedStyle(header).paddingLeft),
      )
      .toBe(0)
  })

  it('offers Rename, Remove from tune, and Delete on a row', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    show()
    await expect
      .element(page.getByRole('button', { name: `${RENAME} Jam recording` }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Remove from tune Jam recording' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Delete Jam recording' }))
      .toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })

  it('renames a recording from its own row', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, label: 'Jam recording' }))
    show()
    await page.getByRole('button', { name: `${RENAME} Jam recording` }).click()
    await expect.element(page.getByText(RENAME_RECORDING_TITLE)).toBeVisible()
    await page.getByRole('textbox', { name: RECORDING_NAME_LABEL }).fill('Barn dance')
    await page.getByRole('button', { name: 'Save' }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.label).toBe('Barn dance'))
  })

  it('asks before deleting a recording, saying what it costs', async () => {
    await db.recordings.put(
      recordingRow('r1', { tune_id: tuneId, label: 'Jam recording', state: 'ready' }),
    )
    show()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await expect.element(page.getByText(DELETE_RECORDING_TITLE)).toBeVisible()
    await expect.element(page.getByText(DELETE_SYNCED_NOTE)).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.deleted_at).not.toBeNull())
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
  })

  it('drops a link from its own row', async () => {
    const linkId = await addLink(db, tuneId, { ...youtube, title: 'Slow version' })
    show()
    await expect.element(page.getByRole('heading', { name: 'Slow version' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Slow version' }).click()
    await vi.waitFor(async () =>
      expect((await db.recording_links.get(linkId))?.deleted_at).not.toBeNull(),
    )
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
  })

  it('records from a tune with nothing recorded yet', async () => {
    // The control lives on the group's header, and an empty group would take it off the
    // screen with it.
    show()
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
    await expect.element(page.getByText(NO_MEDIA_HINT)).toBeVisible()
    await expect.element(page.getByRole('button', { name: ADD_RECORDING })).toBeVisible()
  })

  it('renders no card around the empty state', async () => {
    show()
    await expect.element(page.getByText(NO_MEDIA_TITLE)).toBeVisible()
    expect(document.querySelector('ion-list.list-inset')).toBeNull()
  })

  it('names both ways to add one in words, behind the plus every other screen uses', async () => {
    show()
    await expect.element(page.getByRole('button', { name: ADD_RECORDING })).toBeVisible()
    // Ionic copies an aria-label onto its inner native button and takes it off the host, so the
    // control is found by role rather than by the attribute it was written with. Scoped to the
    // header, so a control left behind below the card could not satisfy this.
    const header = page.elementLocator(document.querySelector('[data-section-header]')!)
    const add = header.getByRole('button', { name: ADD_RECORDING })
    await expect.element(add).toBeVisible()
    await add.click()
    // A glyph reads as nothing aloud and, on a tune synced from another device, the empty
    // state that names these is never seen. The menu is where the words are.
    for (const label of [NEW_RECORDING, PASTE_LINK, FIND_RECORDINGS]) {
      await expect.element(await menuItem(label)).toBeVisible()
    }
  })

  it('opens the paste link sheet from the menu', async () => {
    show()
    const add = page.getByRole('button', { name: ADD_RECORDING })
    await expect.element(add).toBeVisible()
    await add.click()
    await (await menuItem(PASTE_LINK)).click()
    await expect.element(page.getByRole('textbox', { name: 'Link' })).toBeVisible()
  })

  it('opens the find recordings sheet from the menu', async () => {
    show()
    await page.getByRole('button', { name: ADD_RECORDING }).click()
    await (await menuItem(FIND_RECORDINGS)).click()
    await expect.element(page.getByRole('dialog', { name: FIND_RECORDINGS })).toBeVisible()
  })

  it('opens straight on the one chosen service the app searches, and searches it', async () => {
    await onlyChoose('tidal')
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'ok',
      groups: [],
    }))
    show(fakeEngine({ searchRecordings }))
    await page.getByRole('button', { name: ADD_RECORDING }).click()
    const tidal = await menuItem(searchService('TIDAL'))
    await expect.element(tidal).toBeVisible()
    expect(page.getByText(FIND_RECORDINGS, { exact: true }).elements()).toHaveLength(0)
    await tidal.click()
    await expect.element(page.getByRole('dialog', { name: 'TIDAL' })).toBeVisible()
    await vi.waitFor(() => expect(searchRecordings).toHaveBeenCalledOnce())
    expect(searchRecordings.mock.calls[0]![0]).toBe("Soldier's Joy")
    expect(searchRecordings.mock.calls[0]![1]).toEqual(['tidal'])
  })

  it("opens the one chosen service's own search page, with no sheet", async () => {
    await onlyChoose('spotify')
    const spotifySearch = 'https://open.spotify.com/search/soldier'
    const tab = {
      opener: {} as unknown,
      document: document.implementation.createHTMLDocument(),
      close: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const searchRecordings = vi.fn<SyncEngine['searchRecordings']>(async () => ({
      kind: 'ok',
      groups: [
        { provider: 'spotify', status: 'search_only', results: [], search_url: spotifySearch },
      ],
    }))
    try {
      show(fakeEngine({ searchRecordings }))
      await page.getByRole('button', { name: ADD_RECORDING }).click()
      await (await menuItem(searchService('Spotify'))).click()
      await vi.waitFor(() => expect(tab.document.querySelector('a')?.href).toBe(spotifySearch))
      await expect.poll(() => open.mock.calls.length).toBe(1)
      expect(searchRecordings).toHaveBeenCalledWith("Soldier's Joy", ['spotify'], deviceCountry())
      await reopenMenu()
      expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
    } finally {
      open.mockRestore()
    }
  })

  it("says why the one chosen service's search page couldn't open", async () => {
    await onlyChoose('spotify')
    const tab = { opener: {} as unknown, close: vi.fn(), closed: false }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    try {
      show(fakeEngine({ searchRecordings: async () => ({ kind: 'failed' }) }))
      await page.getByRole('button', { name: ADD_RECORDING }).click()
      await (await menuItem(searchService('Spotify'))).click()
      await expect.element(page.getByText(SEARCH_FAILED)).toBeVisible()
    } finally {
      open.mockRestore()
    }
  })

  it('refuses to find recordings offline, saying why on the item', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      show()
      await page.getByRole('button', { name: ADD_RECORDING }).click()
      const item = await menuItem(FIND_RECORDINGS)
      await expect.element(item).toBeVisible()
      await expect.element(await menuItem(SEARCH_NEEDS_CONNECTION)).toBeVisible()
      await item.click()
      await reopenMenu()
      expect(page.getByRole('dialog', { name: FIND_RECORDINGS }).elements()).toHaveLength(0)
    } finally {
      onLine.mockRestore()
    }
  })

  it('refuses a lone search-only service offline, saying why on the item', async () => {
    await onlyChoose('spotify')
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const open = vi.spyOn(window, 'open')
    try {
      show()
      await page.getByRole('button', { name: ADD_RECORDING }).click()
      const item = await menuItem(searchService('Spotify'))
      await expect.element(item).toBeVisible()
      await expect.element(await menuItem(SEARCH_NEEDS_CONNECTION)).toBeVisible()
      await item.click()
      await reopenMenu()
      expect(open).not.toHaveBeenCalled()
    } finally {
      onLine.mockRestore()
      open.mockRestore()
    }
  })

  it('opens nothing for a lone search-only service when the tune has no name to search', async () => {
    await onlyChoose('spotify')
    await db.tunes.update(tuneId, { title: '   ' })
    const open = vi.spyOn(window, 'open')
    try {
      show()
      await page.getByRole('button', { name: ADD_RECORDING }).click()
      await (await menuItem(searchService('Spotify'))).click()
      await reopenMenu()
      expect(open).not.toHaveBeenCalled()
    } finally {
      open.mockRestore()
    }
  })

  it('keeps the header text legible beside its control at 320px', async () => {
    await page.viewport(320, 640)
    try {
      show()
      await expect.element(page.getByRole('button', { name: ADD_RECORDING })).toBeVisible()
      const line = () => document.querySelector<HTMLElement>('[data-section-header]')!
      const heading = () => line().querySelector<HTMLElement>('h2')!
      const controls = () => Array.from(line().querySelectorAll<HTMLElement>('ion-button'))
      await expect.poll(controls).toHaveLength(1)
      // Flex alone keeps these from overlapping, so what this pins is that the heading is not
      // ellipsised away and the control is not pushed off the screen to do it.
      await expect.poll(() => heading().scrollWidth - heading().clientWidth).toBeLessThanOrEqual(0)
      const box = () => controls()[0]!.getBoundingClientRect()
      await expect.poll(() => Math.round(box().width)).toBeGreaterThanOrEqual(44)
      await expect.poll(() => Math.round(box().right)).toBeLessThanOrEqual(320)
    } finally {
      await page.viewport(390, 844)
    }
  })
})
