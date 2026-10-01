import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import {
  addUploadedFile,
  appendChunk,
  beginCapture,
  finishCapture,
  storeDownloadedBlob,
  updateRecording,
} from '../../commands/recordings'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { renderIonic, renderScreen } from '../../test/ionic'
import { fakeEngine, fakePlaybackEngine } from '../../test/providers'
import { CANCEL, DELETE } from '../../ui/Confirm'
import { MORE_ACTIONS } from '../../ui/Menu'
import { recordingRow } from '../../test/rows'
import { OPEN_RECORDING, PAUSE } from '../player/Dock'
import type { PlaybackEngine } from '../player/playbackEngine'
import { usePlayer } from '../player/usePlayer'
import { DOWNLOAD_FAILED, NOT_AVAILABLE } from '../recording/format'
import { ADD_TO_TUNE_TITLE } from '../recordings/AddToTuneSheet'
import { RecordingsPage } from '../recordings/RecordingsPage'
import { RECORDING_NAME_LABEL, RENAME_RECORDING_TITLE } from '../recordings/RenameRecordingSheet'
import { ADD_TO_TUNE, DELETE_RECORDING_TITLE, RENAME } from '../recordings/useRecordingActions'
import { BACK, PRACTICE } from '../practice/practiceCopy'
import { CLOSE_RECORDING, TRIM_BUSY, TRIM_WHILE_DOWNLOADING } from './RecordingScreen'
import { SEEK_LABEL } from './Waveform'
import { SPEED } from './SpeedPanel'
import { PITCH } from './PitchPanel'
import { SKIP_MS } from './Transport'
import { TRIM } from './TrimView'
import { EDIT_RECORDING } from './useRecordingScreen'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

/** A recording captured on this device, so its blob is already held locally. */
async function localRecording(label: string): Promise<string> {
  const id = newId()
  await beginCapture(db, id, { tuneId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
  await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
  await finishCapture(db, id, {
    tuneId: null,
    mime: 'audio/mp4',
    durationMs: 30_000,
    recordedAt: '2026-09-14T20:00:00.000Z',
    peaks: null,
  })
  await updateRecording(db, id, { label })
  vi.mocked(updateRecording).mockClear()
  return id
}

const presented = () => document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

/** The shown modal. Its contents are slotted into, not under, the role its shadow root holds. */
async function dialog() {
  await expect.poll(presented).not.toBeNull()
  return page.elementLocator(presented()!)
}

const never = new Promise<never>(() => {})

/** A recording the server holds and this device does not. */
async function remoteRecording(label: string, extra: Partial<LocalRecording> = {}) {
  await db.recordings.put(
    recordingRow('r1', {
      label,
      state: 'ready',
      duration_ms: 9000,
      source_duration_ms: 9000,
      playback_start_ms: 0,
      playback_end_ms: 9000,
      ...extra,
    }),
  )
}

/** The Recordings tab with the dock and the screen, opened through a row's Edit action. */
async function openFromRows(
  label: string,
  {
    syncEngine,
    engine = fakePlaybackEngine(),
  }: { syncEngine?: SyncEngine; engine?: PlaybackEngine } = {},
) {
  const load = vi.spyOn(engine, 'load')
  renderScreen(<RecordingsPage />, {
    db,
    engine: syncEngine,
    path: '/recordings',
    route: '/recordings',
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: `${EDIT_RECORDING} ${label}` }).click()
  return { engine, load }
}

async function trimTool() {
  return (await dialog()).getByRole('button', { name: new RegExp(`^${TRIM}`) })
}

/** The menu's popover, open on a mouse. */
async function menuItem(label: string) {
  const popover = await vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>('ion-popover:not(.overlay-hidden)')
    if (!open) throw new Error('The menu is not open')
    return open
  })
  return page.elementLocator(popover).getByText(label, { exact: true })
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A key pressed with focus on nothing in particular. */
function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('RecordingScreen', () => {
  it("opens from the row's Edit action and starts that recording in the player", async () => {
    await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderScreen(<RecordingsPage />, {
      db,
      path: '/recordings',
      route: '/recordings',
      playbackEngine: engine,
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
    await expect.element(page.getByRole('dialog', { name: 'Jam recording' })).toBeVisible()
    await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![0]).toMatch(/^blob:/)

    await (await dialog()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(() => document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
  })

  it('offers Trim and Practice, and no Speed or Pitch', async () => {
    await localRecording('Jam recording')
    await openFromRows('Jam recording')
    const screen = await dialog()
    await expect.element(await trimTool()).toBeVisible()
    await expect.element(screen.getByRole('button', { name: PRACTICE, exact: true })).toBeVisible()
    expect(screen.getByRole('button', { name: new RegExp(`^${SPEED}`) }).elements()).toHaveLength(0)
    expect(screen.getByRole('button', { name: new RegExp(`^${PITCH}`) }).elements()).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: new RegExp(`^${PRACTICE},`) }).elements(),
    ).toHaveLength(0)
  })

  it('shows a speed and pitch away from the default as a badge that opens Practice', async () => {
    await localRecording('Jam recording')
    await db.recordings.toCollection().modify({ speed_percent: 75, pitch_cents: 200 })
    await openFromRows('Jam recording')
    const screen = await dialog()
    const tool = screen.getByRole('button', { name: `${PRACTICE} 75% · +2`, exact: true })
    await expect.element(tool).toHaveAttribute('data-tool', 'practice')
    const badge = screen.getByRole('button', { name: `${PRACTICE}, 75% · +2`, exact: true })
    await badge.click()
    await expect.element(screen.getByRole('heading', { name: PRACTICE })).toBeVisible()
  })

  it('shows the speed alone as the badge when only the speed is changed', async () => {
    await localRecording('Jam recording')
    await db.recordings.toCollection().modify({ speed_percent: 75 })
    await openFromRows('Jam recording')
    const screen = await dialog()
    await screen.getByRole('button', { name: `${PRACTICE}, 75%`, exact: true }).click()
    await expect.element(screen.getByRole('heading', { name: PRACTICE })).toBeVisible()
  })

  it('Practice waits for a recording that is still downloading, as Trim does', async () => {
    await remoteRecording('Remote take')
    await openFromRows('Remote take', { syncEngine: fakeEngine({ download: () => never }) })
    const practice = (await dialog()).getByRole('button', { name: new RegExp(`^${PRACTICE}`) })
    await expect.element(practice).toHaveAttribute('aria-disabled', 'true')
    await expect.element(practice).toHaveTextContent(TRIM_WHILE_DOWNLOADING)
  })

  it('Practice stays open while a trim is pending', async () => {
    await db.recordings.put(
      recordingRow('r1', {
        label: 'Server take',
        state: 'ready',
        duration_ms: 9000,
        source_duration_ms: 9000,
        trim_start_ms: 2000,
        playback_start_ms: 0,
        playback_end_ms: 9000,
        playback_rev: 'aaaa1111',
      }),
    )
    await storeDownloadedBlob(db, 'r1', new Blob(['abc']), 'audio/mp4', 'aaaa1111', 0)
    await openFromRows('Server take')
    const practice = (await dialog()).getByRole('button', { name: PRACTICE, exact: true })
    await expect.element(practice).not.toHaveAttribute('aria-disabled', 'true')
    await practice.click()
    await expect.element((await dialog()).getByRole('heading', { name: PRACTICE })).toBeVisible()
  })

  it('Trim is disabled while a trim is pending', async () => {
    await db.recordings.put(
      recordingRow('r1', {
        label: 'Server take',
        state: 'ready',
        duration_ms: 9000,
        source_duration_ms: 9000,
        trim_start_ms: 2000,
        playback_start_ms: 0,
        playback_end_ms: 9000,
        playback_rev: 'aaaa1111',
      }),
    )
    await storeDownloadedBlob(db, 'r1', new Blob(['abc']), 'audio/mp4', 'aaaa1111', 0)
    renderScreen(<RecordingsPage />, {
      db,
      path: '/recordings',
      route: '/recordings',
      playbackEngine: fakePlaybackEngine(),
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: `${EDIT_RECORDING} Server take` }).click()
    const trim = (await dialog()).getByRole('button', { name: new RegExp(`^${TRIM}`) })
    await expect.element(trim).toHaveAttribute('aria-disabled', 'true')
    await expect.element(trim).toHaveTextContent(TRIM_BUSY)
    await trim.click({ force: true })
    expect(page.getByRole('button', { name: CANCEL }).elements()).toHaveLength(0)
  })

  it('Trim waits for a recording that is still downloading', async () => {
    await remoteRecording('Remote take')
    await openFromRows('Remote take', { syncEngine: fakeEngine({ download: () => never }) })
    await expect.element(await trimTool()).toHaveTextContent(TRIM_WHILE_DOWNLOADING)
  })

  it("Trim says so when the recording's download failed", async () => {
    await remoteRecording('Remote take')
    await openFromRows('Remote take', { syncEngine: fakeEngine({ download: async () => null }) })
    await expect.element(await trimTool()).toHaveTextContent(DOWNLOAD_FAILED)
  })

  it('Trim says the device is offline when it holds no audio and cannot fetch any', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await remoteRecording('Remote take')
    await openFromRows('Remote take')
    await expect.element(await trimTool()).toHaveTextContent(OFFLINE)
  })

  it('Trim says why it waits for a recording with no audio that is not ready', async () => {
    await remoteRecording('Remote take', { state: 'processing', playback_rev: null })
    const download = vi.fn(async () => null)
    await openFromRows('Remote take', { syncEngine: fakeEngine({ download }) })
    const trim = await trimTool()
    await expect.element(trim).toHaveAttribute('aria-disabled', 'true')
    await expect.element(trim).toHaveTextContent('Processing')
  })

  it('Trim waits for the upload of an imported file whose length could not be read', async () => {
    const file = new File(['webm'], 'Session.webm', { type: 'audio/webm' })
    await addUploadedFile(db, file, { tuneId: null, label: 'Session', durationMs: null })
    await openFromRows('Session')
    const trim = await trimTool()
    await expect.element(trim).toHaveAttribute('aria-disabled', 'true')
    await expect.element(trim).toHaveTextContent(NOT_AVAILABLE)
  })

  it('Trim opens on an imported file measured at import', async () => {
    const file = new File(['m4a'], 'Session.m4a', { type: 'audio/mp4' })
    await addUploadedFile(db, file, { tuneId: null, label: 'Session', durationMs: 42_000 })
    await openFromRows('Session')
    await expect.element(await trimTool()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('fetches the current audio for a stale blob and keeps playing the held one', async () => {
    await remoteRecording('Remote take', { playback_rev: 'bbbbbbbb' })
    await storeDownloadedBlob(db, 'r1', new Blob(['old']), 'audio/mp4', 'aaaaaaaa', 0)
    const download = vi.fn(() => never)
    renderScreen(<RecordingsPage />, {
      db,
      engine: fakeEngine({ download }),
      path: '/recordings',
      route: '/recordings',
      playbackEngine: fakePlaybackEngine(),
      recordingScreen: true,
    })
    await page.getByRole('button', { name: `${EDIT_RECORDING} Remote take` }).click()
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith('r1'))
    await expect.element(await trimTool()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('opens the trim view and comes back from it', async () => {
    await localRecording('Jam recording')
    renderScreen(<RecordingsPage />, {
      db,
      path: '/recordings',
      route: '/recordings',
      playbackEngine: fakePlaybackEngine(),
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
    await (await dialog()).getByRole('button', { name: TRIM }).click()
    await (await dialog()).getByRole('button', { name: CANCEL }).click()
    await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
  })

  it("opens from the dock's title without reloading what the dock plays", async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    function Opener() {
      const { play } = usePlayer()
      return (
        <button type="button" onClick={() => play({ kind: 'recording', id })}>
          Play recording
        </button>
      )
    }
    renderIonic(<Opener />, { db, playbackEngine: engine, recordingScreen: true, dock: true })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await page.getByRole('button', { name: OPEN_RECORDING('Jam recording') }).click()
    await expect.element(page.getByRole('dialog', { name: 'Jam recording' })).toBeVisible()
    await expect.element((await dialog()).getByRole('button', { name: PAUSE })).toBeVisible()
    expect(load).toHaveBeenCalledOnce()
  })

  it('plays and pauses with Space, except on a focused button', async () => {
    await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderScreen(<RecordingsPage />, {
      db,
      path: '/recordings',
      route: '/recordings',
      playbackEngine: engine,
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await expect.poll(() => engine.getState().playing).toBe(true)
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(false)
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.element((await dialog()).getByRole('button', { name: PAUSE })).toBeVisible()

    // Space on a focused button presses that button and leaves playback alone.
    ;((await dialog()).getByRole('button', { name: PRACTICE }).element() as HTMLElement).focus()
    await userEvent.keyboard(' ')
    await expect.element((await dialog()).getByRole('heading', { name: PRACTICE })).toBeVisible()
    expect(engine.getState().playing).toBe(true)
    await expect.element((await dialog()).getByRole('button', { name: PAUSE })).toBeVisible()
  })

  it('switches to Practice from its menu and still returns focus to the row on close', async () => {
    await localRecording('Jam recording')
    await openFromRows('Jam recording')
    const edit = page.getByRole('button', { name: `${EDIT_RECORDING} Jam recording` })
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(PRACTICE)).click()
    await expect.element((await dialog()).getByRole('heading', { name: PRACTICE })).toBeVisible()
    await (await dialog()).getByRole('button', { name: BACK }).click()
    await (await dialog()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(presented).toBeNull()
    // The row's Edit is an Ionic button, which takes focus on its host.
    const host = (edit.element().getRootNode() as ShadowRoot).host
    await expect.poll(() => document.activeElement).toBe(host)
  })

  it('leaves Practice out of its menu while Practice cannot run', async () => {
    await remoteRecording('Remote take')
    await openFromRows('Remote take', { syncEngine: fakeEngine({ download: () => never }) })
    await expect.element(await trimTool()).toHaveTextContent(TRIM_WHILE_DOWNLOADING)
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await menuItem(DELETE)
    expect((await menuItem(PRACTICE)).elements()).toHaveLength(0)
  })

  it('renames from its menu', async () => {
    await localRecording('Jam recording')
    await openFromRows('Jam recording')
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(RENAME)).click()
    await expect.element(page.getByText(RENAME_RECORDING_TITLE)).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: RECORDING_NAME_LABEL }))
      .toHaveValue('Jam recording')
  })

  it('files an unfiled recording from its menu', async () => {
    await localRecording('Jam recording')
    await openFromRows('Jam recording')
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(ADD_TO_TUNE)).click()
    await expect.element(page.getByText(ADD_TO_TUNE_TITLE)).toBeVisible()
  })

  it('deletes from its menu after asking, and closes', async () => {
    const id = await localRecording('Jam recording')
    await openFromRows('Jam recording')
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(DELETE)).click()
    await expect.element(page.getByText(DELETE_RECORDING_TITLE)).toBeVisible()
    const alert = await vi.waitFor(() => {
      const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
      if (!open) throw new Error('The confirmation is not open')
      return open
    })
    await page.elementLocator(alert).getByRole('button', { name: DELETE, exact: true }).click()
    await expect.poll(async () => (await db.recordings.get(id))?.deleted_at).not.toBeNull()
    await expect.poll(presented).toBeNull()
  })

  it('skips with the arrow keys, except on a focused button', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openFromRows('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    // The screen takes keys only once its modal is presented, which can lag the load.
    await dialog()
    engine.seek(10_000)
    press('ArrowRight')
    expect(engine.getState().positionMs).toBe(10_000 + SKIP_MS)
    press('ArrowLeft')
    press('ArrowLeft')
    expect(engine.getState().positionMs).toBe(0)
    const trim = (await trimTool()).element() as HTMLElement
    trim.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(engine.getState().positionMs).toBe(0)
  })

  it('leaves the keys alone for a held Space or a menu stacked on the screen', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openFromRows('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await expect.poll(() => engine.getState().playing).toBe(true)
    await dialog()
    press(' ', { repeat: true })
    expect(engine.getState().playing).toBe(true)
    await (await dialog()).getByRole('button', { name: MORE_ACTIONS }).click()
    await menuItem(RENAME)
    press(' ')
    press('ArrowRight')
    expect(engine.getState().playing).toBe(true)
    expect(engine.getState().positionMs).toBe(0)
  })

  it('does nothing with the keys before the audio has loaded', async () => {
    await remoteRecording('Remote take')
    const { engine } = await openFromRows('Remote take', {
      syncEngine: fakeEngine({ download: () => never }),
    })
    await expect.element(await trimTool()).toBeVisible()
    const play = vi.spyOn(engine, 'play')
    press(' ')
    press('ArrowRight')
    expect(play).not.toHaveBeenCalled()
    expect(engine.getState().positionMs).toBe(0)
  })

  it('moves focus into the trim view and back onto Trim', async () => {
    await localRecording('Jam recording')
    await openFromRows('Jam recording')
    await (await trimTool()).click()
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.textContent)
      .toBe(CANCEL)
    await (await dialog()).getByRole('button', { name: CANCEL }).click()
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.dataset.tool)
      .toBe('trim')
  })

  it('stays open when opened again while it was still closing', async () => {
    const id = await localRecording('Jam recording')
    function Opener() {
      const { play } = usePlayer()
      return (
        <button type="button" onClick={() => play({ kind: 'recording', id })}>
          Play recording
        </button>
      )
    }
    renderIonic(<Opener />, {
      db,
      playbackEngine: fakePlaybackEngine(),
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    const opener = page.getByRole('button', { name: OPEN_RECORDING('Jam recording') })
    await opener.click()
    await (await dialog()).getByRole('button', { name: CLOSE_RECORDING }).click()
    ;(opener.element() as HTMLElement).click()
    await wait(800)
    expect(presented()).not.toBeNull()
    await expect.element((await dialog()).getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
  })

  it("returns focus to the dock's title when it closes", async () => {
    const id = await localRecording('Jam recording')
    function Opener() {
      const { play } = usePlayer()
      return (
        <button type="button" onClick={() => play({ kind: 'recording', id })}>
          Play recording
        </button>
      )
    }
    renderIonic(<Opener />, {
      db,
      playbackEngine: fakePlaybackEngine(),
      recordingScreen: true,
      dock: true,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    const opener = page.getByRole('button', { name: OPEN_RECORDING('Jam recording') })
    await opener.click()
    await (await dialog()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(presented).toBeNull()
    await expect.poll(() => document.activeElement).toBe(opener.element())
  })
})
