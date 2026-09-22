import { IonContent, IonPage, IonRouterOutlet, IonTabs } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { StrictMode } from 'react'
import { Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { PhoneTabBar } from '../../app/PhoneTabBar'
import { RECORD_LABEL } from '../../app/tabs'
import { addLink, removeLink } from '../../commands/links'
import {
  appendChunk,
  beginCapture,
  deleteRecording,
  finishCapture,
  setFileState,
  updateRecording,
} from '../../commands/recordings'
import { createSong } from '../../commands/songs'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { fakeEngine } from '../../test/providers'
import { Screen } from '../../ui/Screen'
import { DOWNLOAD_FAILED } from '../recording/format'
import { CLOSE_PLAYER, Dock } from './Dock'
import { usePlayer, type PlayerItem } from './usePlayer'

let db: CrosstuneDb
let songId: string

beforeEach(async () => {
  db = openTestDb()
  songId = (await createSong(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).songId
})

afterEach(async () => {
  await db.delete()
})

function addYouTube() {
  return addLink(db, songId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Cluck Old Hen on YouTube',
  })
}

function addSpotify() {
  return addLink(db, songId, {
    url: 'https://open.spotify.com/track/403iATVGis7FqKA0BcTSRt',
    provider: 'spotify',
    provider_ref: 'track:403iATVGis7FqKA0BcTSRt',
    title: 'Soldiers Joy on Spotify',
  })
}

/** A recording captured on this device, so its blob is already held locally. */
async function localRecording(label: string): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { songId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    songId,
    mime: 'audio/mp4',
    durationMs: 3000,
    recordedAt: '2026-09-14T20:00:00.000Z',
  })
  await updateRecording(db, id, { label })
  return id
}

/** A recording with no label and no song, so its title has nothing to fall back to but its date. */
async function unfiledRecording(): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { songId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    songId: null,
    mime: 'audio/mp4',
    durationMs: 3000,
    recordedAt: '2026-09-14T20:00:00.000Z',
  })
  // finishCapture gives every recording a default date-based label; clear it to reach the
  // title's own recorded-at fallback.
  await updateRecording(db, id, { label: null })
  return id
}

/** A recording the server holds and this device does not, so playing it must download it. */
async function remoteRecording(id: string, state = 'ready'): Promise<string> {
  await db.recordings.put({
    id,
    created_at: '2026-09-14T20:00:00.000Z',
    updated_at: '2026-09-14T20:00:00.000Z',
    deleted_at: null,
    server_seq: 3,
    song_id: songId,
    label: 'From my other phone',
    source: 'microphone',
    recorded_at: '2026-09-14T20:00:00.000Z',
    position: 0,
    state,
    duration_ms: 3000,
    playback_mime: 'audio/mp4',
    playback_bytes: 3,
    error: null,
  })
  return id
}

/** One button per item, so a test loads the dock the way a row does. */
function Openers({ items }: { items: { label: string; item: PlayerItem }[] }) {
  const { play } = usePlayer()
  return (
    <>
      {items.map(({ label, item }) => (
        <button key={label} type="button" onClick={() => play(item)}>
          {label}
        </button>
      ))}
    </>
  )
}

function renderDock(
  items: { label: string; item: PlayerItem }[],
  { engine, strict = false }: { engine?: SyncEngine; strict?: boolean } = {},
) {
  const tree = (
    <>
      <Openers items={items} />
      <Dock />
    </>
  )
  return renderIonic(strict ? <StrictMode>{tree}</StrictMode> : tree, { db, engine })
}

/** The dock where it really lives: in the tab frame, between the pages and the tab bar. */
function renderFrame(
  items: { label: string; item: PlayerItem }[],
  /** Render the real Screen, whose fullscreen content scrolls its rows past the page's own box. */
  { screen = false }: { screen?: boolean } = {},
) {
  const body = <Openers items={items} />
  return renderIonic(
    <IonReactMemoryRouter initialEntries={['/catalog']}>
      <div className="ion-page">
        <IonTabs>
          <IonRouterOutlet>
            <Route
              path="*"
              element={
                screen ? (
                  <Screen title="Catalog" level="top">
                    <p className="px-5" data-page-text>
                      A line at the screen's own text gutter
                    </p>
                    {body}
                    <div style={{ height: '2000px' }} />
                  </Screen>
                ) : (
                  <IonPage>
                    <IonContent>{body}</IonContent>
                  </IonPage>
                )
              }
            />
          </IonRouterOutlet>
          <Dock />
          <PhoneTabBar hidden={false} onRecord={() => {}} />
        </IonTabs>
      </div>
    </IonReactMemoryRouter>,
    { db },
  )
}

const dock = () => page.getByRole('region', { name: 'Player' })
const dockElement = () => document.querySelector<HTMLElement>('section[aria-label="Player"]')

/** Puts focus in the dock, where a tap on its close button leaves it. */
function focusClose() {
  const button = dock().getByRole('button', { name: CLOSE_PLAYER }).element()
  const native = button.shadowRoot?.querySelector('button') ?? button
  ;(native as HTMLElement).focus()
}

describe('Dock', () => {
  it('renders nothing while nothing is loaded', async () => {
    const linkId = await addYouTube()
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await expect.element(page.getByRole('button', { name: 'Play link' })).toBeVisible()
    expect(dockElement()).toBeNull()
  })

  it('plays a link in an iframe from the provider embed', async () => {
    const linkId = await addYouTube()
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()

    await expect.element(dock()).toBeVisible()
    await expect.element(page.getByText('Cluck Old Hen on YouTube')).toBeVisible()
    await expect
      .poll(() => dockElement()?.querySelector('iframe')?.src)
      .toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1')
    const frame = dockElement()!.querySelector('iframe')!
    expect(frame.getAttribute('title')).toBe('Cluck Old Hen on YouTube')
    expect(frame.getAttribute('height')).toBe('200')
  })

  it('closes itself when the loaded link has no player', async () => {
    const linkId = await addLink(db, songId, {
      url: 'https://example.com/cluck-old-hen',
      provider: 'other',
    })
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()

    await expect.poll(() => dockElement()).toBeNull()
  })

  it('plays a held recording through an audio element named for the row', async () => {
    const id = await localRecording('Jam recording')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock()).toBeVisible()
    await expect.element(page.getByText('Jam recording')).toBeVisible()
    // The blob url is minted from an effect, one render after the recording itself loads.
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    const audio = dockElement()!.querySelector('audio')!
    expect(audio.hasAttribute('autoplay')).toBe(true)
    expect(audio.getAttribute('aria-label')).toBe('Jam recording')
    expect(dockElement()!.querySelector('iframe')).toBeNull()
  })

  it('titles an unlabeled, unfiled recording by its date rather than a bare "Recording"', async () => {
    const id = await unfiledRecording()
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock()).toBeVisible()
    // The browser project runs in the machine's own zone, so the date itself is not asserted.
    await expect.element(page.getByText('Recording, ', { exact: false })).toBeVisible()
  })

  it('mints one object url per recording and revokes every one it minted', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const first = await localRecording('First recording')
    const second = await localRecording('Second recording')
    renderDock(
      [
        { label: 'Play first', item: { kind: 'recording', id: first } },
        { label: 'Play second', item: { kind: 'recording', id: second } },
      ],
      { strict: true },
    )

    await page.getByRole('button', { name: 'Play first' }).click()
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    await page.getByRole('button', { name: 'Play second' }).click()
    await expect.element(page.getByText('Second recording')).toBeVisible()
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    await dock().getByRole('button', { name: CLOSE_PLAYER }).click()
    await expect.poll(() => dockElement()).toBeNull()

    // StrictMode mounts each body twice, so the count is not the point here: every url that was
    // minted, by a kept pass or a discarded one, is revoked exactly once.
    const minted = create.mock.results.map((result) => result.value as string)
    expect(minted.length).toBeGreaterThanOrEqual(2)
    expect(revoke).toHaveBeenCalledTimes(minted.length)
    for (const url of minted) expect(revoke).toHaveBeenCalledWith(url)
  })

  it('mints one object url each for two recordings it switches between', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const first = await localRecording('First recording')
    const second = await localRecording('Second recording')
    renderDock([
      { label: 'Play first', item: { kind: 'recording', id: first } },
      { label: 'Play second', item: { kind: 'recording', id: second } },
    ])

    await page.getByRole('button', { name: 'Play first' }).click()
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    const firstSrc = dockElement()!.querySelector('audio')!.src

    await page.getByRole('button', { name: 'Play second' }).click()
    await expect.element(page.getByText('Second recording')).toBeVisible()
    await expect
      .poll(() => {
        const src = dockElement()?.querySelector('audio')?.src
        return src !== undefined && src.startsWith('blob:') && src !== firstSrc
      })
      .toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('keeps one object url while the recording is read again', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const id = await localRecording('Jam recording')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    const audio = dockElement()!.querySelector('audio')

    await setFileState(db, id, 'uploading')
    // The row change re-renders the dock with a freshly read but equivalent blob; give that a
    // beat before asking whether anything minted a second url.
    await expect
      .poll(() => db.recording_files.get(id).then((file) => file?.local_state))
      .toBe('uploading')
    await expect.element(page.getByText('Jam recording')).toBeVisible()
    expect(dockElement()!.querySelector('audio')).toBe(audio)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('downloads a recording it does not hold and shows the progress meanwhile', async () => {
    const id = await remoteRecording('remote')
    let release: (blob: Blob | null) => void = () => {}
    const download = vi.fn(() => new Promise<Blob | null>((resolve) => (release = resolve)))
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      engine: fakeEngine({ download }),
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    // Downloading is what the body says the moment a ready recording arrives with no blob, so
    // it shows a frame before the effect behind it asks the engine for the file.
    await expect.element(dock().getByText('Downloading')).toBeVisible()
    await vi.waitFor(() => expect(download).toHaveBeenCalled())
    release(new Blob(['xyz'], { type: 'audio/mp4' }))
    await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when a download brings nothing back, and tries again', async () => {
    const id = await remoteRecording('remote')
    const download = vi.fn(async () => null)
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      engine: fakeEngine({ download }),
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock().getByText(DOWNLOAD_FAILED)).toBeVisible()
    expect(download).toHaveBeenCalledTimes(1)
    await dock().getByRole('button', { name: 'Retry' }).click()
    await expect.poll(() => download.mock.calls.length).toBe(2)
  })

  it('says it is offline rather than downloading while there is no connection', async () => {
    const id = await remoteRecording('remote')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      engine: fakeEngine({ download: () => new Promise(() => {}) }),
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock().getByText('Offline')).toBeVisible()
    expect(dockElement()!.textContent).not.toContain('Downloading')
    expect(page.getByRole('button', { name: 'Retry' }).query()).toBeNull()
    // Nothing offline is disabled: the dock's own control keeps its name and its tap.
    await expect.element(dock().getByRole('button', { name: CLOSE_PLAYER })).toBeEnabled()
  })

  it('closes itself when the loaded recording is tombstoned', async () => {
    const id = await localRecording('Jam recording')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock()).toBeVisible()

    await deleteRecording(db, id)
    await expect.poll(() => dockElement()).toBeNull()
  })

  it('holds its content through the read that replaces it', async () => {
    const first = await addYouTube()
    const second = await addSpotify()
    renderDock([
      { label: 'Play first', item: { kind: 'link', id: first } },
      { label: 'Play second', item: { kind: 'link', id: second } },
    ])
    await page.getByRole('button', { name: 'Play first' }).click()
    await expect.element(dock()).toBeVisible()
    const section = dockElement()

    // A read of the replacement takes a turn of the event loop, so watching for the section's
    // removal is what says whether the dock went empty in between rather than holding on.
    const removed: Node[] = []
    const collect = (records: MutationRecord[]) => {
      for (const record of records) removed.push(...record.removedNodes)
    }
    const observer = new MutationObserver(collect)
    observer.observe(document.body, { childList: true, subtree: true })
    try {
      await page.getByRole('button', { name: 'Play second' }).click()
      await expect.element(page.getByText('Soldiers Joy on Spotify')).toBeVisible()
    } finally {
      collect(observer.takeRecords())
      observer.disconnect()
    }
    expect(removed.some((node) => node === section || node.contains(section))).toBe(false)
    expect(dockElement()).toBe(section)
    expect(section!.querySelectorAll('iframe')).toHaveLength(1)
    expect(section!.querySelector('iframe')!.src).toBe(
      'https://open.spotify.com/embed/track/403iATVGis7FqKA0BcTSRt',
    )
  })

  it('publishes its offset for floating controls and clears it on close', async () => {
    const linkId = await addYouTube()
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    const published = () => document.documentElement.style.getPropertyValue('--player-dock-offset')
    expect(published()).toBe('')

    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()
    // The video player's 200px plus the dock's own 56px of chrome.
    expect(published()).toBe('calc(256px + var(--tab-bar-cap))')

    await dock().getByRole('button', { name: CLOSE_PLAYER }).click()
    await expect.poll(() => dockElement()).toBeNull()
    expect(published()).toBe('')
  })

  it('returns focus to the control that opened it', async () => {
    const linkId = await addYouTube()
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()

    await dock().getByRole('button', { name: CLOSE_PLAYER }).click()
    await expect.poll(() => dockElement()).toBeNull()
    await expect.element(page.getByRole('button', { name: 'Play link' })).toHaveFocus()
  })

  it('returns focus to the opening control when it closes itself', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()
    focusClose()
    expect(dockElement()!.contains(document.activeElement)).toBe(true)

    await removeLink(db, linkId)
    await expect.poll(() => dockElement()).toBeNull()
    await expect.element(page.getByRole('button', { name: 'Play link' })).toHaveFocus()
  })

  it('leaves focus alone when it closes itself with focus elsewhere', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

    await removeLink(db, linkId)
    await expect.poll(() => dockElement()).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('sits above the tab bar, clear of the record button, without covering the page', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()

    const section = dockElement()!.getBoundingClientRect()
    const bar = document.querySelector('ion-tab-bar')!.getBoundingClientRect()
    const dome = document
      .querySelector(`button[aria-label="${RECORD_LABEL}"]`)!
      .getBoundingClientRect()
    const outlet = document.querySelector('ion-router-outlet')!.getBoundingClientRect()
    expect(section.bottom).toBeLessThanOrEqual(bar.top)
    expect(section.bottom).toBeLessThanOrEqual(dome.top)
    expect(outlet.bottom).toBeLessThanOrEqual(section.top)
    expect(section.height).toBe(256)
  })

  it('paints the clearance below its surface opaque, not the page behind it', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()

    const frame = dockElement()!.parentElement!
    const surface = getComputedStyle(dockElement()!).backgroundColor
    expect(getComputedStyle(frame).backgroundColor).toBe(surface)
    expect(surface).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('hands the audio control the dark face in dark mode', async () => {
    const id = await localRecording('Jam recording')
    document.documentElement.classList.add('ion-palette-dark')
    try {
      renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
      await page.getByRole('button', { name: 'Play recording' }).click()
      await expect.poll(() => dockElement()?.querySelector('audio')?.src).toMatch(/^blob:/)
      const audio = dockElement()!.querySelector('audio')!
      expect(getComputedStyle(audio).colorScheme).toBe('dark')
    } finally {
      document.documentElement.classList.remove('ion-palette-dark')
    }
  })

  it('stays in front of a page whose rows scroll past their own box', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }], { screen: true })
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()
    const section = dockElement()!
    const box = section.getBoundingClientRect()
    const under = document.elementFromPoint(box.left + 8, box.top + 8)
    expect(section.contains(under)).toBe(true)
    const close = section.querySelector('ion-button')!
    const closeBox = close.getBoundingClientRect()
    const onClose = document.elementFromPoint(
      closeBox.left + closeBox.width / 2,
      closeBox.top + closeBox.height / 2,
    )
    expect(onClose?.closest('ion-button')).toBe(close)
    // The bar and its dome still come out on top of the player below them.
    const dome = document.querySelector(`button[aria-label="${RECORD_LABEL}"]`)!
    const domeBox = dome.getBoundingClientRect()
    const onDome = document.elementFromPoint(
      domeBox.left + domeBox.width / 2,
      domeBox.top + domeBox.height / 2,
    )
    expect(dome.contains(onDome)).toBe(true)
  })

  it('lines its name up with the text gutter the page uses on the wide frame', async () => {
    await page.viewport(1024, 768)
    try {
      const linkId = await addYouTube()
      renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }], { screen: true })
      await page.getByRole('button', { name: 'Play link' }).click()
      await expect.element(dock()).toBeVisible()
      const section = dockElement()!
      const title = section.querySelector('span.type-headline')!.getBoundingClientRect()
      const paragraph = document.querySelector('[data-page-text]')!
      // A padding box, so where the page's text starts is the box plus its own gutter.
      const line =
        paragraph.getBoundingClientRect().left + parseFloat(getComputedStyle(paragraph).paddingLeft)
      expect(line).toBeGreaterThan(0)
      expect(title.left).toBe(line)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('keeps its height on a viewport too short for it and the pages both', async () => {
    const linkId = await addYouTube()
    renderFrame([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()
    await expect.element(dock()).toBeVisible()
    const tall = document.querySelector('ion-router-outlet')!.getBoundingClientRect().height

    await page.viewport(390, 420)
    try {
      await expect
        .poll(() => document.querySelector('ion-router-outlet')!.getBoundingClientRect().height)
        .toBeLessThan(tall)
      const section = dockElement()!.getBoundingClientRect()
      const bar = document.querySelector('ion-tab-bar')!.getBoundingClientRect()
      const dome = document
        .querySelector(`button[aria-label="${RECORD_LABEL}"]`)!
        .getBoundingClientRect()
      expect(section.height).toBe(256)
      expect(section.bottom).toBeLessThanOrEqual(bar.top)
      expect(section.bottom).toBeLessThanOrEqual(dome.top)
      expect(bar.bottom).toBeLessThanOrEqual(420)
    } finally {
      await page.viewport(390, 844)
    }
  })
})
