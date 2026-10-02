import { IonContent, IonPage, IonRouterOutlet, IonTabs } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { StrictMode } from 'react'
import { Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { PhoneTabBar } from '../../app/PhoneTabBar'
import { RECORD_LABEL } from '../../app/tabs'
import { addLink, removeLink } from '../../commands/links'
import { removeLoop, updateLoop } from '../../commands/loops'
import {
  deleteRecording,
  setFileState,
  storeDownloadedBlob,
  updateRecording,
} from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { renderIonic } from '../../test/ionic'
import { fakeEngine, FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { Screen } from '../../ui/Screen'
import { loopRow } from '../../test/rows'
import { presentedModal } from '../../test/dialogs'
import { loopHolds } from '../practice/useLoopFollow'
import { DOWNLOAD_FAILED } from '../recording/format'
import { RecordProvider, useRecord } from '../recording/useRecord'
import { Dock, PLAY_FAILED } from './Dock'
import { PlaybackEngine, type EngineClock } from './playbackEngine'
import {
  CLOSE_PLAYER,
  OPEN_RECORDING,
  PAUSE,
  PITCH_BADGE,
  PITCH_LABEL,
  PITCH_UNAVAILABLE,
  PLAY,
  REPEAT_LOOP,
  REPEATING_BADGE,
  SPEED_BADGE,
  SPEED_LABEL,
} from './transportCopy'
import { usePlayer, type PlayerItem } from './usePlayer'

const realClock: EngineClock = {
  every: (ms, fn) => {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  },
  after: (ms, fn) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  tuneId = (await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).tuneId
})

afterEach(async () => {
  await db.delete()
})

function addYouTube() {
  return addLink(db, tuneId, {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    provider: 'youtube',
    provider_ref: 'dQw4w9WgXcQ',
    title: 'Cluck Old Hen on YouTube',
  })
}

function addSpotify() {
  return addLink(db, tuneId, {
    url: 'https://open.spotify.com/track/403iATVGis7FqKA0BcTSRt',
    provider: 'spotify',
    provider_ref: 'track:403iATVGis7FqKA0BcTSRt',
    title: 'Soldiers Joy on Spotify',
  })
}

/** A recording captured on this device, so its blob is already held locally. */
function localRecording(label: string): Promise<string> {
  return captureRecording(db, { tuneId, durationMs: 3000, label })
}

/** A recording with no label and no tune, so its title has nothing to fall back to but its date. */
function unfiledRecording(): Promise<string> {
  // finishCapture gives every recording a default date-based label; clear it to reach the
  // title's own recorded-at fallback.
  return captureRecording(db, { durationMs: 3000, label: null })
}

/** A recording the server holds and this device does not, so playing it must download it. */
async function remoteRecording(id: string, state = 'ready'): Promise<string> {
  await db.recordings.put({
    id,
    created_at: '2026-09-14T20:00:00.000Z',
    updated_at: '2026-09-14T20:00:00.000Z',
    deleted_at: null,
    server_seq: 3,
    tune_id: tuneId,
    label: 'From my other phone',
    source: 'microphone',
    recorded_at: '2026-09-14T20:00:00.000Z',
    position: 0,
    state,
    duration_ms: 3000,
    playback_mime: 'audio/mp4',
    playback_bytes: 3,
    error: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    speed_percent: 100,
    pitch_cents: 0,
    // A transcode always fills these in before a recording reaches 'ready'.
    source_duration_ms: 3000,
    playback_start_ms: 0,
    playback_end_ms: 3000,
    playback_rev: 'aaaaaaaa',
    peaks_rev: null,
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

/** Starts a recording the way the record flow does, through `useRecord().start()`. */
function StartRecordingButton() {
  const { start } = useRecord()
  return (
    <button type="button" onClick={() => start()}>
      Start recording
    </button>
  )
}

function renderDock(
  items: { label: string; item: PlayerItem }[],
  {
    engine,
    strict = false,
    playbackEngine = fakePlaybackEngine(),
  }: { engine?: SyncEngine; strict?: boolean; playbackEngine?: PlaybackEngine } = {},
) {
  const tree = (
    <>
      <Openers items={items} />
      <Dock />
    </>
  )
  return renderIonic(strict ? <StrictMode>{tree}</StrictMode> : tree, {
    db,
    engine,
    playbackEngine,
  })
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
    const linkId = await addLink(db, tuneId, {
      url: 'https://example.com/cluck-old-hen',
      provider: 'other',
    })
    renderDock([{ label: 'Play link', item: { kind: 'link', id: linkId } }])
    await page.getByRole('button', { name: 'Play link' }).click()

    await expect.poll(() => dockElement()).toBeNull()
  })

  it('plays a recording from its trim start, from a Play tap on the row', async () => {
    const id = await localRecording('Jam recording')
    await updateRecording(db, id, { trim_start_ms: 1000 })
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock()).toBeVisible()
    await expect
      .element(dock().getByRole('button', { name: OPEN_RECORDING('Jam recording') }))
      .toBeVisible()
    // The blob url is minted from an effect, one render after the recording itself loads.
    await expect.poll(() => load.mock.calls.length).toBe(1)
    const [, span, settings, meta] = load.mock.calls[0]!
    expect(span).toEqual({ fromS: 1, toS: 3, lengthMs: 2000 })
    expect(settings).toEqual({ speedPercent: 100, pitchCents: 0 })
    expect(meta).toEqual({ title: 'Jam recording' })
    // Every recording reaches the dock from a Play tap, so it starts playing on its own.
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    expect(dockElement()!.querySelector('iframe')).toBeNull()
  })

  it('shows a speed and pitch badge away from their defaults, and none at the defaults', async () => {
    const plain = await localRecording('Plain recording')
    const tuned = await localRecording('Tuned recording')
    await updateRecording(db, tuned, { speed_percent: 75, pitch_cents: 230 })
    renderDock([
      { label: 'Play plain', item: { kind: 'recording', id: plain } },
      { label: 'Play tuned', item: { kind: 'recording', id: tuned } },
    ])

    await page.getByRole('button', { name: 'Play plain' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    expect(dockElement()!.querySelector('[data-playback-badge]')).toBeNull()

    await page.getByRole('button', { name: 'Play tuned' }).click()
    // The visible text sits beside sr-only "Speed"/"Pitch" labels, which are part of the
    // same element's text content.
    await expect
      .element(
        dock().getByText(`${SPEED_LABEL} ${SPEED_BADGE(75)} ${PITCH_LABEL} ${PITCH_BADGE(230)}`),
      )
      .toBeVisible()
  })

  it('shows the loop it repeats and opens the recording screen from it', async () => {
    const id = await localRecording('Jam recording')
    const loop = newId()
    await db.recording_loops.put(
      loopRow({ id: loop, recording_id: id, label: 'B part', start_ms: 500, end_ms: 2500 }),
    )
    const engine = fakePlaybackEngine()
    renderIonic(
      <Openers items={[{ label: 'Play recording', item: { kind: 'recording', id } }]} />,
      {
        db,
        playbackEngine: engine,
        recordingScreen: true,
        dock: true,
      },
    )
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    expect(dockElement()!.querySelector('[data-repeat-badge]')).toBeNull()

    engine.setLoop({ id: loop, label: 'B part', fromS: 0.5, toS: 2.5 })
    // A selected loop alone, with Repeat off, shows nothing.
    expect(dockElement()!.querySelector('[data-repeat-badge]')).toBeNull()
    engine.setRepeat(true)
    const badge = dock().getByRole('button', { name: REPEATING_BADGE('B part') })
    await expect.element(badge).toBeVisible()
    const toggle = dock().getByRole('button', { name: REPEAT_LOOP('B part'), exact: true })
    await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')

    await badge.click()
    await expect
      .poll(() => presentedModal()?.querySelector('ion-title')?.textContent)
      .toBe('Jam recording')
    expect(engine.getState().repeat).toBe(true)
  })

  describe('with Practice closed', () => {
    /** A playing recording repeating its B part loop, with no Practice view mounted. */
    async function repeating() {
      const id = await localRecording('Jam recording')
      const loop = newId()
      await db.recording_loops.put(
        loopRow({ id: loop, recording_id: id, label: 'B part', start_ms: 500, end_ms: 2500 }),
      )
      const element = new FakeAudioElement()
      const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
      renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
        playbackEngine: engine,
      })
      await page.getByRole('button', { name: 'Play recording' }).click()
      await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
      engine.setLoop({ id: loop, label: 'B part', fromS: 0.5, toS: 2.5 })
      engine.setRepeat(true)
      return { id, loop, element, engine }
    }

    it('keeps wrapping the loop once a trim replaces the blob', async () => {
      const { id, element, engine } = await repeating()
      await storeDownloadedBlob(db, id, new Blob(['xyz']), 'audio/mp4', 'bbbbbbbb', 500)
      // The loop's source times, now in seconds into a blob that starts 500 ms in.
      await expect.poll(() => engine.loopRange).toMatchObject({ fromS: 0, toS: 2 })
      expect(engine.getState().repeat).toBe(true)
      element.currentTime = 1
      await new Promise((resolve) => setTimeout(resolve, 120))
      element.currentTime = 2.1
      await expect.poll(() => element.currentTime).toBe(0)
    })

    it('turns Repeat off and drops the badge when the loop is deleted', async () => {
      const { loop, engine } = await repeating()
      await expect
        .element(dock().getByRole('button', { name: REPEATING_BADGE('B part') }))
        .toBeVisible()
      await removeLoop(db, loop)
      await expect.poll(() => engine.getState().repeat).toBe(false)
      expect(engine.getState().loop).toBeNull()
      await expect.poll(() => dockElement()!.querySelector('[data-repeat-badge]')).toBeNull()
    })

    it('shows a renamed loop in the badge', async () => {
      const { loop, engine } = await repeating()
      await updateLoop(db, loop, { label: 'Bridge' })
      await expect
        .element(dock().getByRole('button', { name: REPEATING_BADGE('Bridge') }))
        .toBeVisible()
      expect(engine.loopRange?.label).toBe('Bridge')
    })
  })

  it('keeps room for both Repeat targets beside a long badge on a narrow phone', async () => {
    const id = await localRecording('Jam recording')
    await updateRecording(db, id, { speed_percent: 75, pitch_cents: -150 })
    // A real row, since the dock drops a repeating loop it can't find.
    await db.recording_loops.put(
      loopRow({
        id: 'loop-1',
        recording_id: id,
        label: 'The long turnaround',
        start_ms: 500,
        end_ms: 2500,
      }),
    )
    const engine = fakePlaybackEngine()
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.viewport(320, 640)
    try {
      await page.getByRole('button', { name: 'Play recording' }).click()
      await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
      engine.setLoop({ id: 'loop-1', label: 'The long turnaround', fromS: 0.5, toS: 2.5 })
      engine.setRepeat(true)
      await expect.poll(() => dockElement()!.querySelector('[data-repeat-badge]')).not.toBeNull()
      const wrapper = dockElement()!.querySelector<HTMLElement>('[data-repeat-badge]')!
      const box = wrapper.getBoundingClientRect()
      for (const target of wrapper.querySelectorAll('button')) {
        const rect = target.getBoundingClientRect()
        expect(rect.width).toBeGreaterThanOrEqual(44)
        expect(rect.left).toBeGreaterThanOrEqual(box.left - 0.5)
        expect(rect.right).toBeLessThanOrEqual(box.right + 0.5)
      }
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('clears the selection from the stop control beside the badge', async () => {
    const id = await localRecording('Jam recording')
    // A real row, since the dock drops a repeating loop it can't find.
    await db.recording_loops.put(
      loopRow({ id: 'loop-1', recording_id: id, label: 'B part', start_ms: 500, end_ms: 2500 }),
    )
    const engine = fakePlaybackEngine()
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    engine.setLoop({ id: 'loop-1', label: 'B part', fromS: 0.5, toS: 2.5 })
    engine.setRepeat(true)
    const span = { startMs: 700, endMs: 2000 }
    loopHolds(engine).set({ id: 'loop-1', span, base: { startMs: 500, endMs: 2500 } })
    await dock()
      .getByRole('button', { name: REPEAT_LOOP('B part'), exact: true })
      .click()
    await expect.poll(() => engine.getState().repeat).toBe(false)
    await expect.poll(() => dockElement()!.querySelector('[data-repeat-badge]')).toBeNull()
    expect(engine.getState().loop).toBeNull()
    expect(loopHolds(engine).get()).toBeNull()
  })

  it('formats the pitch badge in semitones, one decimal only off a whole semitone', () => {
    expect(PITCH_BADGE(200)).toBe('+2')
    expect(PITCH_BADGE(-100)).toBe('-1')
    expect(PITCH_BADGE(230)).toBe('+2.3')
    expect(PITCH_BADGE(-150)).toBe('-1.5')
  })

  it('rounds the fractional semitone from integer cents, not the raw float', () => {
    expect(PITCH_BADGE(201)).toBe('+2.0')
    expect(PITCH_BADGE(205)).toBe('+2.1')
    expect(PITCH_BADGE(-250)).toBe('-2.5')
    expect(PITCH_BADGE(100)).toBe('+1')
    expect(PITCH_BADGE(-1200)).toBe('-12')
  })

  it('rounds a negative magnitude the same as its positive counterpart, sign aside', () => {
    // Math.round alone rounds halves toward +Infinity, so the magnitude is rounded before
    // the sign is put back on.
    expect(PITCH_BADGE(-205)).toBe('-2.1')
  })

  it('never rounds a non-zero pitch away to a bare 0.0', () => {
    expect(PITCH_BADGE(1)).toBe('+0.1')
    expect(PITCH_BADGE(-1)).toBe('-0.1')
    expect(PITCH_BADGE(-4)).toBe('-0.1')
  })

  it('adjusts the engine in place, never reloading, when a trim, speed, or pitch change arrives', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    const setWindow = vi.spyOn(engine, 'setWindow')
    const setSpeed = vi.spyOn(engine, 'setSpeed')
    const setPitch = vi.spyOn(engine, 'setPitch')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)

    await updateRecording(db, id, { trim_start_ms: 1000 })
    await expect.poll(() => setWindow.mock.calls.length).toBe(1)
    expect(setWindow.mock.calls[0]![0]).toEqual({ fromS: 1, toS: 3, lengthMs: 2000 })

    await updateRecording(db, id, { speed_percent: 75, pitch_cents: -100 })
    await expect.poll(() => setSpeed.mock.calls.length).toBe(1)
    expect(setSpeed.mock.calls[0]![0]).toBe(75)
    expect(setPitch.mock.calls[0]![0]).toBe(-100)

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('leaves a paused recording paused, at the same position, when its speed changes remotely', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    await dock().getByRole('button', { name: PAUSE }).click()
    await expect.element(dock().getByRole('button', { name: PLAY })).toBeVisible()
    const position = engine.getState().positionMs

    await updateRecording(db, id, { speed_percent: 75 })
    await expect.element(dock().getByText(`${SPEED_LABEL} ${SPEED_BADGE(75)}`)).toBeVisible()

    expect(engine.getState().playing).toBe(false)
    expect(engine.getState().positionMs).toBe(position)
  })

  it('does not reload when only the title changes', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    const setMetadata = vi.spyOn(engine, 'setMetadata')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)

    await updateRecording(db, id, { label: 'Renamed recording' })
    await expect.element(page.getByText('Renamed recording')).toBeVisible()
    await expect.poll(() => setMetadata.mock.calls.length).toBe(1)
    expect(setMetadata.mock.calls[0]![0]).toEqual({ title: 'Renamed recording' })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("mints a fresh url and reloads when a trim replaces this recording's blob in place", async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    const setWindow = vi.spyOn(engine, 'setWindow')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![4]).toEqual({ keepLoop: false })
    engine.setRepeat(true)
    const firstSrc = create.mock.results[0]!.value as string

    // A trim job regenerates the playback file in place: the same recording, a new blob at
    // a new revision and a new offset into the source, but `hasBlob` never toggles. This also
    // changes `span` (its window now starts at a different blob offset), on the render before
    // the new blob even has a url: the span/settings/metadata effects must not act on it then,
    // since it still describes the blob load() is about to replace.
    await storeDownloadedBlob(
      db,
      id,
      new Blob(['xyz'], { type: 'audio/mp4' }),
      'audio/mp4',
      'bbbbbbbb',
      500,
    )

    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(create).toHaveBeenCalledTimes(2)
    const secondSrc = create.mock.results[1]!.value as string
    expect(secondSrc).not.toBe(firstSrc)
    expect(revoke).toHaveBeenCalledWith(firstSrc)
    expect(load.mock.calls[1]![0]).toBe(secondSrc)
    expect(load.mock.calls[1]![4]).toEqual({ keepLoop: true })
    expect(engine.getState().repeat).toBe(true)
    // The reload alone applies the new span; setWindow never ran against the old, superseded
    // blob in between.
    expect(setWindow).not.toHaveBeenCalled()
  })

  it('keeps a paused recording paused, at its place, when a trim replaces its blob', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    await dock().getByRole('button', { name: PAUSE }).click()
    engine.seek(1500)

    await storeDownloadedBlob(db, id, new Blob(['xyz']), 'audio/mp4', 'bbbbbbbb', 0)
    await expect.poll(() => load.mock.calls.length).toBe(2)
    await expect.element(dock().getByRole('button', { name: PLAY })).toBeVisible()
    expect(engine.getState()).toMatchObject({ playing: false, positionMs: 1500 })
  })

  it('keeps a playing recording playing, at its place, when a trim replaces its blob', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    engine.seek(1500)

    await storeDownloadedBlob(db, id, new Blob(['xyz']), 'audio/mp4', 'bbbbbbbb', 0)
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(engine.getState()).toMatchObject({ playing: true, positionMs: 1500 })
  })

  it('plays a stale blob while fetching the current revision, then swaps it in', async () => {
    const id = await remoteRecording('remote')
    await db.recordings.update(id, { playback_rev: 'bbbbbbbb' })
    await storeDownloadedBlob(db, id, new Blob(['old']), 'audio/mp4', 'aaaaaaaa', 0)
    let release: () => void = () => {}
    const download = vi.fn(
      () =>
        new Promise<Blob | null>((resolve) => {
          release = () => {
            const blob = new Blob(['new'], { type: 'audio/mp4' })
            void storeDownloadedBlob(db, id, blob, 'audio/mp4', 'bbbbbbbb', 0).then(() =>
              resolve(blob),
            )
          }
        }),
    )
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      engine: fakeEngine({ download }),
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith(id))
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    engine.seek(1000)

    release()
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(engine.getState()).toMatchObject({ playing: true, positionMs: 1000 })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('unloads the engine when the dock closes', async () => {
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()

    await dock().getByRole('button', { name: CLOSE_PLAYER }).click()
    await expect.poll(() => dockElement()).toBeNull()
    expect(engine.getState()).toEqual({
      playing: false,
      positionMs: 0,
      lengthMs: 0,
      failed: false,
      pitchUnavailable: false,
      loop: null,
      repeat: false,
    })
  })

  it('unloads the engine when starting a recording closes the player', async () => {
    const owned = (['mediaDevices', 'storage'] as const).map(
      (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
    )
    const { getUserMedia } = stubMediaGlobals()
    // Never resolves, so the record modal stays on its starting phase: the assertion below
    // only needs the synchronous player.close() at the top of start(), not a real capture.
    getUserMedia.mockImplementation(() => new Promise(() => {}))
    try {
      const id = await localRecording('Jam recording')
      const engine = fakePlaybackEngine()
      renderIonic(
        <RecordProvider>
          <StartRecordingButton />
          <Openers items={[{ label: 'Play recording', item: { kind: 'recording', id } }]} />
          <Dock />
        </RecordProvider>,
        { db, playbackEngine: engine },
      )
      await page.getByRole('button', { name: 'Play recording' }).click()
      await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()

      await page.getByRole('button', { name: 'Start recording' }).click()
      await expect.poll(() => dockElement()).toBeNull()
      expect(engine.getState().playing).toBe(false)
    } finally {
      for (const [key, descriptor] of owned) {
        if (descriptor) Object.defineProperty(navigator, key, descriptor)
        else Reflect.deleteProperty(navigator, key)
      }
      vi.unstubAllGlobals()
    }
  })

  it('shows a play-failed message and lets a Play tap try again', async () => {
    const id = await localRecording('Jam recording')
    const element = new FakeAudioElement()
    element.play = () => Promise.reject(new Error('blocked by autoplay policy'))
    const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
    const play = vi.spyOn(engine, 'play')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock().getByText(PLAY_FAILED)).toBeVisible()
    // The play button itself is the retry: badge, timers, and progress stay hidden while
    // failed, but Play is still there and still named Play (never started, so never paused).
    await expect.element(dock().getByRole('button', { name: PLAY })).toBeVisible()
    await expect.poll(() => play.mock.calls.length).toBe(1)

    await dock().getByRole('button', { name: PLAY }).click()

    await expect.poll(() => play.mock.calls.length).toBe(2)
  })

  it('shows a pitch-unavailable notice when the stored pitch cannot apply', async () => {
    const id = await localRecording('Jam recording')
    await updateRecording(db, id, { pitch_cents: 200 })
    const failingStage = async () => {
      throw new Error('worklet unavailable')
    }
    const engine = new PlaybackEngine(
      new FakeAudioElement() as unknown as HTMLAudioElement,
      realClock,
      failingStage,
    )
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()

    await expect.element(dock().getByText(PITCH_UNAVAILABLE)).toBeVisible()
    // Still playable: pitch just does not apply, so the transport controls stay usable.
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
  })

  it('gives the elapsed and remaining timers, and the badge, their own accessible names', async () => {
    const id = await localRecording('Jam recording')
    await updateRecording(db, id, { speed_percent: 75, pitch_cents: 200 })
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()

    await expect
      .element(dock().getByRole('timer', { name: /^Elapsed /, exact: false }))
      .toBeVisible()
    const remaining = dock().getByRole('timer', { name: /^Remaining /, exact: false })
    await expect.element(remaining).toBeVisible()
    // The visible text keeps its minus sign; only the accessible name drops it.
    expect(await remaining.element().getAttribute('aria-label')).not.toContain('-')
    await expect.element(dock().getByText(SPEED_LABEL, { exact: false })).toBeVisible()
    await expect.element(dock().getByText(PITCH_LABEL, { exact: false })).toBeVisible()
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
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    await page.getByRole('button', { name: 'Play second' }).click()
    await expect.element(page.getByText('Second recording')).toBeVisible()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    await dock().getByRole('button', { name: CLOSE_PLAYER }).click()
    await expect.poll(() => dockElement()).toBeNull()

    // StrictMode mounts each body twice, so the count is not the point here: every url that was
    // minted, by a kept pass or a discarded one, is revoked exactly once.
    const minted = create.mock.results.map((result) => result.value as string)
    expect(minted.length).toBeGreaterThanOrEqual(2)
    expect(revoke).toHaveBeenCalledTimes(minted.length)
    for (const url of minted) expect(revoke).toHaveBeenCalledWith(url)
  })

  it('mints one object url each for two recordings it switches between, never loading a revoked one', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    const first = await localRecording('First recording')
    const second = await localRecording('Second recording')
    renderDock(
      [
        { label: 'Play first', item: { kind: 'recording', id: first } },
        { label: 'Play second', item: { kind: 'recording', id: second } },
      ],
      { playbackEngine: engine },
    )

    await page.getByRole('button', { name: 'Play first' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    const firstSrc = create.mock.results[0]!.value as string

    await page.getByRole('button', { name: 'Play second' }).click()
    await expect.element(page.getByText('Second recording')).toBeVisible()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
    expect(create).toHaveBeenCalledTimes(2)
    const secondSrc = create.mock.results[1]!.value as string
    expect(secondSrc).not.toBe(firstSrc)

    // Keyed by recording id, RecordingBody remounts rather than being reused across the
    // switch, so its own load never runs with a url the switch already revoked: each call's
    // src is exactly the one minted for that recording, never the other's.
    expect(load.mock.calls.map((call) => call[0])).toEqual([firstSrc, secondSrc])
    expect(revoke).toHaveBeenCalledWith(firstSrc)
  })

  it('keeps one object url while the recording is read again', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const id = await localRecording('Jam recording')
    const engine = fakePlaybackEngine()
    const load = vi.spyOn(engine, 'load')
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      playbackEngine: engine,
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()

    await setFileState(db, id, 'uploading')
    // The row change re-renders the dock with a freshly read but equivalent blob; give that a
    // beat before asking whether anything minted a second url.
    await expect
      .poll(() => db.recording_files.get(id).then((file) => file?.local_state))
      .toBe('uploading')
    await expect.element(page.getByText('Jam recording')).toBeVisible()
    expect(create).toHaveBeenCalledTimes(1)
    // Neither the recording nor the file that feeds the engine's span actually changed, so
    // this equivalent read never reloads it.
    expect(load).toHaveBeenCalledTimes(1)
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
    const blob = new Blob(['xyz'], { type: 'audio/mp4' })
    // A real download persists the file it fetched before handing the blob back; this
    // fixture does the same so the row it feeds the engine's span is there when it lands.
    await storeDownloadedBlob(db, id, blob, 'audio/mp4', 'aaaaaaaa', 0)
    release(blob)
    await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
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

  it('fetches the audio once the connection comes back', async () => {
    const id = await remoteRecording('remote')
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const download = vi.fn(() => new Promise<Blob | null>(() => {}))
    renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }], {
      engine: fakeEngine({ download }),
    })
    await page.getByRole('button', { name: 'Play recording' }).click()
    await expect.element(dock().getByText('Offline')).toBeVisible()
    expect(download).not.toHaveBeenCalled()

    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await expect.element(dock().getByText('Downloading')).toBeVisible()
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
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

  it('hands the progress bar the dark face in dark mode', async () => {
    const id = await localRecording('Jam recording')
    document.documentElement.classList.add('ion-palette-dark')
    try {
      renderDock([{ label: 'Play recording', item: { kind: 'recording', id } }])
      await page.getByRole('button', { name: 'Play recording' }).click()
      await expect.element(dock().getByRole('button', { name: PAUSE })).toBeVisible()
      const progress = dockElement()!.querySelector('progress')!
      expect(getComputedStyle(progress).colorScheme).toBe('dark')
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
