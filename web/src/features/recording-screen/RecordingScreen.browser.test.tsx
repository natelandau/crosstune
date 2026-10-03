import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addUploadedFile, storeDownloadedBlob, updateRecording } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { menuItem, modal, presentedModal } from '../../test/dialogs'
import { renderIonic, renderScreen } from '../../test/ionic'
import { animateOverlays } from '../../test/overlays'
import { fakeEngine, fakePlaybackEngine } from '../../test/providers'
import { captureRecording, seedLoop } from '../../test/recordings'
import { CANCEL, DELETE } from '../../ui/Confirm'
import { MORE_ACTIONS } from '../../ui/Menu'
import { recordingFile, recordingRow, tuneRow } from '../../test/rows'
import { OPEN_RECORDING, PAUSE, PLAY } from '../player/transportCopy'
import type { PlaybackEngine } from '../player/playbackEngine'
import { usePlayer } from '../player/usePlayer'
import { DOWNLOAD_FAILED, formatDuration, NOT_AVAILABLE } from '../recording/format'
import { ADD_TO_TUNE_TITLE } from '../recordings/AddToTuneSheet'
import { RecordingsPage } from '../recordings/RecordingsPage'
import { RECORDING_NAME_LABEL, RENAME } from '../recordings/recordingCopy'
import { recordedAtLabel } from '../recordings/recordingRow'
import { RENAME_RECORDING_TITLE } from '../recordings/RenameRecordingSheet'
import { ADD_TO_TUNE, DELETE_RECORDING_TITLE } from '../recordings/useRecordingActions'
import {
  FIT,
  LANES_LABEL,
  LOOP_NAME,
  LOOPS_LABEL,
  NEXT_LOOP,
  SEGMENT_LABEL,
} from '../practice/practiceCopy'
import { ARROW_STEP_MS } from '../practice/PracticeWaveform'
import { REMOVE_FROM_TUNE } from '../recordings/useRecordingActions'
import {
  CLOSE_RECORDING,
  TRIM_BUSY,
  TRIM_WHILE_DOWNLOADING,
  TRIM_WHILE_RECORDING,
} from './RecordingScreen'
import { RESET, ZOOM_IN } from './panel'
import { SPEED } from './SpeedPanel'
import { CENTS, PITCH } from './PitchPanel'
import { TRIM } from './TrimView'
import { useRecordingScreen } from './useRecordingScreen'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

/** A recording captured on this device, so its blob is already held locally. */
async function localRecording(label: string): Promise<string> {
  const id = await captureRecording(db, { label })
  vi.mocked(updateRecording).mockClear()
  return id
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

/** The Recordings tab with the dock and the screen, opened by playing a row, then the dock's title. */
async function openFromDock(
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
  await page.getByRole('button', { name: `Play ${label}`, exact: false }).click()
  await page.getByRole('button', { name: OPEN_RECORDING(label) }).click()
  return { engine, load }
}

/** The screen opened on `id` by a caller of `open`, for a recording no row could play yet. */
async function openById(
  id: string,
  {
    syncEngine,
    engine = fakePlaybackEngine(),
  }: { syncEngine?: SyncEngine; engine?: PlaybackEngine } = {},
) {
  function Opener() {
    const { open } = useRecordingScreen()
    return (
      <button type="button" onClick={() => open(id)}>
        Open recording
      </button>
    )
  }
  renderIonic(<Opener />, {
    db,
    engine: syncEngine,
    playbackEngine: engine,
    recordingScreen: true,
    dock: true,
  })
  await page.getByRole('button', { name: 'Open recording' }).click()
  return { engine }
}

/** Opens the ⋯ menu and returns a reader of its labels, in order. */
async function menuLabels() {
  await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
  await menuItem(DELETE)
  return () => {
    const menu = document.querySelector('ion-popover:not(.overlay-hidden)')
    return Array.from(menu?.querySelectorAll('ion-item') ?? []).map(
      (item) => item.querySelector('[data-menu-label]')?.textContent ?? item.textContent,
    )
  }
}

/** Trim in the ⋯ menu, which this opens. */
async function trimItem(): Promise<HTMLIonItemElement> {
  await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
  const label = await menuItem(TRIM)
  await expect.element(label).toBeVisible()
  return (label.element() as HTMLElement).closest('ion-item')!
}

async function expectTrimBlocked(reason: string) {
  const item = await trimItem()
  await expect.poll(() => item.disabled).toBe(true)
  await expect.poll(() => item.textContent).toContain(reason)
}

const waveform = async () => (await modal()).getByRole('slider', { name: LANES_LABEL })

/** Waits for the screen's own content, which mounts its keys and can lag both the load and the
 * modal it shows in, and for its transport to take input, since the keys stand down until then. */
async function screenShown() {
  await expect.element(await waveform()).toBeVisible()
  await expect
    .element((await modal()).getByRole('button', { name: new RegExp(`^(${PLAY}|${PAUSE})$`) }))
    .toBeEnabled()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A key pressed with focus on nothing in particular. */
function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('RecordingScreen', () => {
  it('opens on any recording and starts it in the player', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    await openById(id, { engine })
    await expect.element(page.getByRole('dialog', { name: 'Jam recording' })).toBeVisible()
    await expect.element(await waveform()).toBeVisible()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![0]).toMatch(/^blob:/)

    await (await modal()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(() => document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
  })

  it('opens on the waveform with the Loops mode', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    const screen = await modal()
    await expect.element(await waveform()).toBeVisible()
    await expect
      .element(screen.getByRole('tab', { name: LOOPS_LABEL, exact: true }))
      .toHaveAttribute('aria-selected', 'true')
  })

  /** The play button's center is the transport row's, to within 2 px. */
  async function expectPlayCentered() {
    const screen = await modal()
    const row = screen.element().querySelector<HTMLElement>('[data-practice-transport]')!
    const center = (box: DOMRect) => box.left + box.width / 2
    const play = () =>
      screen
        .getByRole('button', { name: new RegExp(`^(${PLAY}|${PAUSE})$`) })
        .element()
        .getBoundingClientRect()
    await expect
      .poll(() => Math.abs(center(play()) - center(row.getBoundingClientRect())))
      .toBeLessThanOrEqual(2)
    await expect.poll(() => row.querySelector('[data-practice-clock]')).toBeNull()
    await expect.poll(() => row.querySelector(`[aria-label="${ZOOM_IN}"]`)).toBeNull()
  }

  /** The clock in the waveform's bottom-left corner, and zoom in its bottom-right. */
  async function expectOverlaidOnWaveform() {
    const screen = await modal()
    const rect = (selector: string) =>
      screen.element().querySelector<HTMLElement>(selector)!.getBoundingClientRect()
    const wave = () => rect('[data-practice-waveform]')
    const clock = () => rect('[data-practice-clock]')
    const zoomIn = () =>
      screen.getByRole('button', { name: ZOOM_IN }).element().getBoundingClientRect()
    for (const box of [clock, zoomIn]) {
      await expect
        .poll(() => box().top - (wave().top + wave().height / 2))
        .toBeGreaterThanOrEqual(0)
      await expect.poll(() => box().bottom - wave().bottom).toBeLessThanOrEqual(1)
    }
    await expect.poll(() => clock().left - wave().left).toBeLessThanOrEqual(8)
    await expect.poll(() => wave().right - zoomIn().right).toBeLessThanOrEqual(8)
  }

  /** The region under the waveform holds everything without scrolling. */
  async function expectBelowFits() {
    const below = (await modal()).element().querySelector<HTMLElement>('[data-practice-below]')!
    await expect.poll(() => below.scrollHeight - below.clientHeight).toBeLessThanOrEqual(0)
  }

  it('fits every control in a desktop dialog and centers the play controls', async () => {
    await page.viewport(1440, 1200)
    try {
      await localRecording('Jam recording')
      await openFromDock('Jam recording')
      const screen = await modal()
      await expect.element(await waveform()).toBeVisible()
      await screen.getByRole('tab', { name: SPEED, exact: true }).click({ force: true })
      await expectBelowFits()
      await expectPlayCentered()
      await expectOverlaidOnWaveform()
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('centers the play controls on a phone, with the clock and zoom over the waveform', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await expect.element(await waveform()).toBeVisible()
    await expectPlayCentered()
    await expectOverlaidOnWaveform()
  })

  it('fits Speed and Pitch on a phone without scrolling', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    const screen = await modal()
    await expect.element(await waveform()).toBeVisible()
    const inView = (element: Element) => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    }

    await screen.getByRole('tab', { name: SPEED, exact: true }).click({ force: true })
    await expectBelowFits()
    const reset = screen.getByRole('button', { name: RESET })
    await expect.element(reset).toBeVisible()
    await expect.poll(() => inView(reset.element())).toBe(true)

    await screen.getByRole('tab', { name: PITCH, exact: true }).click({ force: true })
    await expectBelowFits()
    const cents = screen.getByRole('slider', { name: CENTS })
    await expect.element(cents).toBeVisible()
    await expect.poll(() => inView(cents.element())).toBe(true)
    await expect
      .poll(() => inView(screen.getByRole('button', { name: RESET }).element()))
      .toBe(true)
  })

  it('shows the date and length under the title, not in the body', async () => {
    const id = await localRecording('Jam recording')
    await openFromDock('Jam recording')
    const screen = await modal()
    await expect.element(await waveform()).toBeVisible()
    const recording = (await db.recordings.get(id))!
    const line = `${recordedAtLabel(recording.recorded_at)} · ${formatDuration(recording.duration_ms)}`
    const header = screen.element().querySelector('ion-header')!
    await expect.poll(() => header.textContent).toContain(line)
    await expect
      .poll(() => screen.element().querySelector('ion-content')!.textContent)
      .not.toContain(line)
  })

  it('shows a speed and pitch away from the default on their segments', async () => {
    await localRecording('Jam recording')
    await db.recordings.toCollection().modify({ speed_percent: 75, pitch_cents: 200 })
    await openFromDock('Jam recording')
    const screen = await modal()
    await expect
      .element(screen.getByRole('tab', { name: SEGMENT_LABEL(SPEED, '75%') }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('tab', { name: SEGMENT_LABEL(PITCH, '+2') }))
      .toBeVisible()
  })

  it('the ⋯ menu offers Trim, Rename, Add to tune, and Delete', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await expect.poll(await menuLabels()).toEqual([TRIM, RENAME, ADD_TO_TUNE, DELETE])
  })

  it('the ⋯ menu offers Remove from tune for a filed recording', async () => {
    await db.tunes.put(tuneRow('t1', 'Tune'))
    const id = await captureRecording(db, { tuneId: 't1', label: 'Jam recording' })
    await openById(id)
    await expect.poll(await menuLabels()).toEqual([TRIM, RENAME, REMOVE_FROM_TUNE, DELETE])
  })

  it('Trim returns to the screen', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await (await trimItem()).click()
    await (await modal()).getByRole('button', { name: CANCEL }).click()
    await expect.element(await waveform()).toBeVisible()
  })

  it('a recording still downloading disables the waveform, transport, and modes with the reason', async () => {
    await remoteRecording('Remote take')
    await openById('r1', { syncEngine: fakeEngine({ download: () => never }) })
    const screen = await modal()
    await expect.element(screen.getByText(TRIM_WHILE_DOWNLOADING, { exact: true })).toBeVisible()
    await expectDisabled()
  })

  it('a recording still capturing disables the waveform, transport, and modes with the reason', async () => {
    const id = await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await expect.element(await waveform()).toBeVisible()
    await db.recording_files.update(id, { local_state: 'capturing' })
    const screen = await modal()
    await expect.element(screen.getByText(TRIM_WHILE_RECORDING, { exact: true })).toBeVisible()
    await expectDisabled()
  })

  it('a take capturing from the start shows a plain bar and the reason', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Live take', state: 'pending' }))
    await db.recording_files.put(
      recordingFile('r1', { local_state: 'capturing', blob: new Blob(['abc']), mime: 'audio/mp4' }),
    )
    await openById('r1')
    const screen = await modal()
    await expect.element(screen.getByText(TRIM_WHILE_RECORDING, { exact: true })).toBeVisible()
    const bar = (selector: string) =>
      presentedModal()?.querySelector(`${selector}[data-timeline-bar] canvas`) ?? null
    await expect.poll(() => bar('[data-practice-waveform]')).not.toBeNull()
    await expect.poll(() => bar('[data-overview]')).not.toBeNull()
    await expectDisabled()
  })

  /** The waveform, the transport, and the modes are out of reach. */
  async function expectDisabled() {
    const screen = await modal()
    const inert = (selector: string) =>
      presentedModal()!.querySelector(selector)?.closest('[inert]') ?? null
    await expect.poll(() => inert('[data-practice-waveform]')).not.toBeNull()
    await expect.poll(() => inert('[data-overview]')).not.toBeNull()
    await expect.poll(() => inert('[data-mode-selector]')).not.toBeNull()
    await expect.poll(() => inert('[data-mode-controls]')).not.toBeNull()
    await expect
      .element(screen.getByRole('button', { name: new RegExp(`^(${PLAY}|${PAUSE})$`) }))
      .toBeDisabled()
  }

  it('keeps the waveform in reach while a trim is pending', async () => {
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
    await openFromDock('Server take')
    await expect.element(await waveform()).toBeVisible()
    await expect
      .poll(() => presentedModal()!.querySelector('[data-practice-waveform]')!.closest('[inert]'))
      .toBeNull()
    await expectTrimBlocked(TRIM_BUSY)
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
    await openFromDock('Server take')
    const item = await trimItem()
    await expect.poll(() => item.disabled).toBe(true)
    await expect.poll(() => item.textContent).toContain(TRIM_BUSY)
    item.click()
    await wait(300)
    expect(page.getByRole('button', { name: CANCEL }).elements()).toHaveLength(0)
  })

  it('Trim waits for a recording that is still downloading', async () => {
    await remoteRecording('Remote take')
    await openById('r1', { syncEngine: fakeEngine({ download: () => never }) })
    await expectTrimBlocked(TRIM_WHILE_DOWNLOADING)
  })

  it("Trim says so when the recording's download failed", async () => {
    await remoteRecording('Remote take')
    await openById('r1', { syncEngine: fakeEngine({ download: async () => null }) })
    await expect.poll(async () => (await trimItem()).textContent).toContain(DOWNLOAD_FAILED)
  })

  it('Trim says the device is offline when it holds no audio and cannot fetch any', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await remoteRecording('Remote take')
    await openById('r1')
    await expectTrimBlocked(OFFLINE)
  })

  it('Trim says why it waits for a recording with no audio that is not ready', async () => {
    await remoteRecording('Remote take', { state: 'processing', playback_rev: null })
    const download = vi.fn(async () => null)
    await openById('r1', { syncEngine: fakeEngine({ download }) })
    await expectTrimBlocked('Processing')
  })

  it('Trim waits for the upload of an imported file whose length could not be read', async () => {
    const file = new File(['webm'], 'Session.webm', { type: 'audio/webm' })
    await addUploadedFile(db, file, { tuneId: null, label: 'Session', durationMs: null })
    await openFromDock('Session')
    await expectTrimBlocked(NOT_AVAILABLE)
  })

  it('Trim opens on an imported file measured at import', async () => {
    const file = new File(['m4a'], 'Session.m4a', { type: 'audio/mp4' })
    await addUploadedFile(db, file, { tuneId: null, label: 'Session', durationMs: 42_000 })
    await openFromDock('Session')
    const item = await trimItem()
    await expect.poll(() => item.disabled).toBe(false)
  })

  it('fetches the current audio for a stale blob and keeps playing the held one', async () => {
    await remoteRecording('Remote take', { playback_rev: 'bbbbbbbb' })
    await storeDownloadedBlob(db, 'r1', new Blob(['old']), 'audio/mp4', 'aaaaaaaa', 0)
    const download = vi.fn(() => never)
    await openById('r1', { syncEngine: fakeEngine({ download }) })
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith('r1'))
    const item = await trimItem()
    await expect.poll(() => item.disabled).toBe(false)
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
    await expect.element((await modal()).getByRole('button', { name: PAUSE })).toBeVisible()
    expect(load).toHaveBeenCalledOnce()
  })

  it('plays and pauses with Space, except on a focused button', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openFromDock('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await expect.poll(() => engine.getState().playing).toBe(true)
    await screenShown()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(false)
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.element((await modal()).getByRole('button', { name: PAUSE })).toBeVisible()

    // Space on a focused button presses that button and leaves playback alone.
    const fit = (await modal()).getByRole('button', { name: FIT, exact: true })
    ;(fit.element() as HTMLElement).focus()
    await userEvent.keyboard(' ')
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.element((await modal()).getByRole('button', { name: PAUSE })).toBeVisible()
  })

  it('renames from its menu', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(RENAME)).click()
    await expect.element(page.getByText(RENAME_RECORDING_TITLE)).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: RECORDING_NAME_LABEL }))
      .toHaveValue('Jam recording')
  })

  it('files an unfiled recording from its menu', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(ADD_TO_TUNE)).click()
    await expect.element(page.getByText(ADD_TO_TUNE_TITLE)).toBeVisible()
  })

  it('deletes from its menu after asking, and closes', async () => {
    const id = await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
    await (await menuItem(DELETE)).click()
    await expect.element(page.getByText(DELETE_RECORDING_TITLE)).toBeVisible()
    const alert = await vi.waitFor(() => {
      const open = document.querySelector<HTMLElement>('ion-alert:not(.overlay-hidden)')
      if (!open) throw new Error('The confirmation is not open')
      return open
    })
    await page.elementLocator(alert).getByRole('button', { name: DELETE, exact: true }).click()
    await expect.poll(async () => (await db.recordings.get(id))?.deleted_at).not.toBeNull()
    await expect.poll(presentedModal).toBeNull()
  })

  it('moves the playhead with the arrow keys, except on a focused button', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openFromDock('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await screenShown()
    // A playing engine would advance between presses.
    engine.pause()
    engine.seek(10_000)
    press('ArrowRight')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000 + ARROW_STEP_MS)
    press('ArrowLeft')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000)
    press('ArrowLeft')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000 - ARROW_STEP_MS)
    const fit = (await modal()).getByRole('button', { name: FIT, exact: true })
    ;(fit.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => engine.getState().positionMs).toBe(10_000 - ARROW_STEP_MS)
  })

  it('leaves the keys alone for a held Space or a menu stacked on the screen', async () => {
    await localRecording('Jam recording')
    const { engine, load } = await openFromDock('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await expect.poll(() => engine.getState().playing).toBe(true)
    await screenShown()
    press(' ', { repeat: true })
    await expect.poll(() => engine.getState().playing).toBe(true)
    await (await modal()).getByRole('button', { name: MORE_ACTIONS }).click()
    await menuItem(RENAME)
    press(' ')
    press('ArrowRight')
    await expect.poll(() => engine.getState().playing).toBe(true)
    await expect.poll(() => engine.getState().positionMs).toBe(0)
  })

  it('does nothing with the keys before the audio has loaded', async () => {
    await remoteRecording('Remote take')
    const { engine } = await openById('r1', {
      syncEngine: fakeEngine({ download: () => never }),
    })
    await expect.element(await waveform()).toBeInTheDocument()
    const play = vi.spyOn(engine, 'play')
    press(' ')
    press('ArrowRight')
    expect(play).not.toHaveBeenCalled()
    await expect.poll(() => engine.getState().positionMs).toBe(0)
  })

  it('moves focus into the trim view and back onto More actions', async () => {
    await localRecording('Jam recording')
    await openFromDock('Jam recording')
    await (await trimItem()).click()
    await expect
      .poll(() => (document.activeElement as HTMLElement | null)?.textContent)
      .toBe(CANCEL)
    await (await modal()).getByRole('button', { name: CANCEL }).click()
    const more = (await modal()).getByRole('button', { name: MORE_ACTIONS })
    await expect.element(more).toBeVisible()
    // An Ionic button takes focus on its host.
    const host = (more.element().getRootNode() as ShadowRoot).host
    await expect.poll(() => document.activeElement).toBe(host)
  })

  it('Escape cancels a rename, then deselects, then closes', async () => {
    const id = await localRecording('Jam recording')
    const loop = await seedLoop(db, id, 10_000, 20_000)
    const { engine, load } = await openFromDock('Jam recording')
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await (await modal()).getByRole('button', { name: NEXT_LOOP }).click()
    await expect.poll(() => engine.getState().loop).not.toBeNull()
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('Enter')
    const field = page.getByRole('textbox', { name: LOOP_NAME })
    await expect.element(field).toHaveFocus()
    await userEvent.keyboard('Typed')
    await userEvent.keyboard('{Escape}')
    await expect.element(field).not.toBeInTheDocument()
    await wait(300)
    expect(presentedModal()).not.toBeNull()
    expect((await db.recording_loops.get(loop))?.label).toBeNull()
    expect(engine.getState().loop).not.toBeNull()

    await userEvent.keyboard('{Escape}')
    await expect.poll(() => engine.getState().loop).toBeNull()
    await wait(300)
    expect(presentedModal()).not.toBeNull()

    await userEvent.keyboard('{Escape}')
    await expect.poll(presentedModal).toBeNull()
  })

  it('stays open when opened again while it was still closing', async () => {
    animateOverlays()
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
    await (await modal()).getByRole('button', { name: CLOSE_RECORDING }).click()
    ;(opener.element() as HTMLElement).click()
    await wait(800)
    expect(presentedModal()).not.toBeNull()
    await expect.element(await waveform()).toBeVisible()
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
    await (await modal()).getByRole('button', { name: CLOSE_RECORDING }).click()
    await expect.poll(presentedModal).toBeNull()
    await expect.poll(() => document.activeElement).toBe(opener.element())
  })
})
