import { IonContent, IonPage } from '@ionic/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { addLink } from '../../commands/links'
import { updateRecording } from '../../commands/recordings'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { renderScreen } from '../../test/ionic'
import { recordingRow } from '../../test/rows'
import type * as RecordModule from '../recording/useRecord'
import { RecordProvider } from '../recording/useRecord'
import { useRecordingsWithFiles } from '../recordings/useRecordings'
import { SongMedia } from './SongMedia'
import { useSong } from './useSong'

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
        start: (songId?: string) => {
          starts.push(songId)
          record.start(songId)
        },
      }
    },
  }
})

let db: CrosstuneDb
let songId: string
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
  ;({ songId } = await createSong(db, { title: "Soldier's Joy" }, { status: 'learning' }))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  restore?.()
  restore = null
  vi.resetAllMocks()
  await db.delete()
})

/** Reads this song's rows and hands them down, the way the song screen mounts the section. */
function Host() {
  const view = useSong(songId)
  const recordings = useRecordingsWithFiles({ songId })
  if (!view || !recordings) return null
  return <SongMedia songId={songId} recordings={recordings} links={view.links} />
}

function show() {
  renderScreen(
    <IonPage>
      <IonContent>
        <RecordProvider>
          <Host />
        </RecordProvider>
      </IonContent>
    </IonPage>,
    { db, path: `/catalog/${songId}`, route: '/catalog/:songId' },
  )
}

const youtube = {
  url: 'https://youtu.be/dQw4w9WgXcQ',
  provider: 'youtube' as const,
  provider_ref: 'dQw4w9WgXcQ',
}

const sectionHeaders = () => Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)
const rowTitles = () => Array.from(document.querySelectorAll('h3')).map((h) => h.textContent)

describe('SongMedia', () => {
  it('names the empty state and the three ways to add a recording', async () => {
    show()
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
    for (const name of ['Record', 'Upload', 'Paste link']) {
      const control = page.getByRole('button', { name, exact: true })
      await expect.element(control).toBeVisible()
      const host = (control.element().getRootNode() as ShadowRoot).host
      expect(host.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })

  it('titles an unlabeled recording by its date rather than repeating the page title', async () => {
    // The song page's own title already names the song, so the row falls to its date instead.
    await db.recordings.put(
      recordingRow('r1', { song_id: songId, label: null, recorded_at: '2026-03-14T20:05:00.000Z' }),
    )
    show()
    // The browser project runs in the machine's own zone, so the date itself is not asserted.
    const row = page.getByRole('heading', { name: 'Recording, ', exact: false, level: 3 })
    await expect.element(row).toBeVisible()
    expect(row.element().textContent).not.toContain("Soldier's Joy")
    expect(sectionHeaders()).toEqual(['Recordings'])
  })

  it('opens the record modal for this song', async () => {
    fakeMedia()
    show()
    await page.getByRole('button', { name: 'Record', exact: true }).click()
    await expect.element(page.getByRole('dialog', { name: 'New recording' })).toBeInTheDocument()
    expect(starts).toEqual([songId])
  })

  it('files an uploaded audio file under this song', async () => {
    show()
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
    await userEvent.upload(
      page.getByLabelText('Upload audio file').element() as HTMLInputElement,
      new File(['abc'], 'jam.m4a', { type: 'audio/mp4' }),
    )
    await expect.element(page.getByRole('heading', { name: 'jam', level: 3 })).toBeVisible()
    const [recording] = await db.recordings.toArray()
    expect(recording?.song_id).toBe(songId)
  })

  it('shows a refused upload on one line under the groups', async () => {
    show()
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
    // The accept attribute is only a picker hint; drag-drop and some pickers still deliver a
    // mismatched file, so the check is bypassed here.
    await userEvent
      .setup({ applyAccept: false })
      .upload(
        page.getByLabelText('Upload audio file').element() as HTMLInputElement,
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      )
    const line = page.getByRole('alert')
    await expect.element(line).toHaveTextContent('Choose an audio file.')
    expect(line.element().closest('ion-item')).toBeNull()
    expect(line.element().getBoundingClientRect().width).toBeGreaterThan(200)
  })

  it('adds a pasted link as a row of its own', async () => {
    show()
    await page.getByRole('button', { name: 'Paste link', exact: true }).click()
    await expect.element(page.getByLabelText('Link')).toBeVisible()
    await page.getByLabelText('Link').fill(youtube.url)
    await page.getByRole('button', { name: 'Add link', exact: true }).click()
    await vi.waitFor(async () => expect(await db.recording_links.count()).toBe(1))
    await expect.element(page.getByRole('heading', { name: 'youtu.be', level: 3 })).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Open youtu.be on YouTube' })).toBeVisible()
  })

  it('holds recordings and links in one list, recordings first', async () => {
    await db.recordings.put(recordingRow('r1', { song_id: songId, label: 'Jam recording' }))
    await addLink(db, songId, { ...youtube, title: 'Slow version' })
    show()
    await expect.element(page.getByRole('heading', { name: 'Slow version' })).toBeVisible()
    expect(sectionHeaders()).toEqual(['Recordings'])
    expect(rowTitles()).toEqual(['Jam recording', 'Slow version'])
    const list = page.getByRole('list', { name: 'Recordings' })
    await expect.element(list.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await expect.element(list.getByRole('heading', { name: 'Slow version' })).toBeVisible()
  })

  it("sits a link's provider line where a recording's metadata sits", async () => {
    await db.recordings.put(recordingRow('r1', { song_id: songId, label: 'Jam recording' }))
    await addLink(db, songId, { ...youtube, title: 'Slow version' })
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
    await db.recordings.put(recordingRow('r1', { song_id: songId, label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove from song Jam recording' }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.song_id).toBeNull())
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
  })

  it('reports a refused row action on one line under the groups', async () => {
    await db.recordings.put(recordingRow('r1', { song_id: songId, label: 'Jam recording' }))
    show()
    await expect.element(page.getByRole('heading', { name: 'Jam recording' })).toBeVisible()
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('The song would not let go.'))
    await page.getByRole('button', { name: 'Remove from song Jam recording' }).click()
    const line = page.getByRole('alert')
    await expect.element(line).toHaveTextContent('The song would not let go.')
    expect(line.element().closest('ion-item')).toBeNull()
    // It sits under the cards, so it lines up with their text rather than starting short of it.
    const header = document.querySelector('h2')!
    expect(Number.parseFloat(getComputedStyle(line.element()).paddingLeft)).toBe(
      Number.parseFloat(getComputedStyle(header).paddingLeft),
    )
  })

  it('opens the rename sheet on the recording a row names', async () => {
    await db.recordings.put(recordingRow('r1', { song_id: songId, label: 'Jam recording' }))
    show()
    await page.getByRole('button', { name: 'Rename Jam recording' }).click()
    await expect.element(page.getByText('Rename recording')).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: 'Recording name' }))
      .toHaveValue('Jam recording')
  })

  it('asks before deleting a recording, saying what it costs', async () => {
    await db.recordings.put(
      recordingRow('r1', { song_id: songId, label: 'Jam recording', state: 'ready' }),
    )
    show()
    await page.getByRole('button', { name: 'Delete Jam recording' }).click()
    await expect.element(page.getByText('Delete this recording?')).toBeVisible()
    await expect.element(page.getByText('It is removed from every device.')).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(async () => expect((await db.recordings.get('r1'))?.deleted_at).not.toBeNull())
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
  })

  it('drops a link from its own row', async () => {
    const linkId = await addLink(db, songId, { ...youtube, title: 'Slow version' })
    show()
    await expect.element(page.getByRole('heading', { name: 'Slow version' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove Slow version' }).click()
    await vi.waitFor(async () =>
      expect((await db.recording_links.get(linkId))?.deleted_at).not.toBeNull(),
    )
    await expect.element(page.getByText('Nothing recorded yet')).toBeVisible()
  })
})
