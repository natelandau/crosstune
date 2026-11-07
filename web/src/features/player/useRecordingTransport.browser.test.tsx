import { renderHook } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { storeDownloadedBlob, updateRecording } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import { newId } from '../../commands/write'
import type { RecordingFile } from '../../db/recordings'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import {
  dataProviders,
  FakeAudioElement,
  fakeEngine,
  fakePlaybackEngine,
  playbackSettings,
} from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import type { HeldSettings } from '../practice/practiceHolds'
import { DOWNLOAD_FAILED } from '../../text/format'
import type { EngineClock, PlaybackEngine } from './playbackEngine'
import { PlaybackEngineContext } from './PlaybackEngineProvider'
import { SPEED_BADGE } from './transportCopy'
import { useRecordingTransport } from './useRecordingTransport'
import type { PlayStart } from './usePlayer'
import { DEFAULT_ISOLATE, isolateToPatch } from './isolate/isolateSetting'

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  tuneId = (await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).tuneId
})

interface Props {
  recording: LocalRecording
  file: RecordingFile | null
}

async function read(id: string): Promise<Props> {
  return {
    recording: (await db.recordings.get(id))!,
    file: (await db.recording_files.get(id)) ?? null,
  }
}

/** A recording the server holds and this device does not, so playing it must download it. */
async function remoteRecording(): Promise<string> {
  const id = newId()
  await db.recordings.put({
    id,
    created_at: '2026-09-14T20:00:00.000Z',
    updated_at: '2026-09-14T20:00:00.000Z',
    deleted_at: null,
    server_seq: 3,
    tune_id: tuneId,
    label: 'From my other phone',
    source: 'microphone',
    origin: 'own',
    origin_url: null,
    added_at: '2026-09-14T20:00:00.000Z',
    recorded_at: '2026-09-14T20:00:00.000Z',
    recorded_precision: 'time',
    position: 0,
    state: 'ready',
    duration_ms: 3000,
    playback_mime: 'audio/mp4',
    playback_bytes: 3,
    error: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    speed_percent: 100,
    pitch_cents: 0,
    source_duration_ms: 3000,
    playback_start_ms: 0,
    playback_end_ms: 3000,
    playback_rev: 'aaaaaaaa',
    peaks_rev: null,
    is_mono: null,
    ...isolateToPatch(DEFAULT_ISOLATE),
    split_completed_id: null,
  })
  return id
}

async function setup(
  id: string,
  {
    held = () => null,
    engine = fakeEngine(),
    playback = fakePlaybackEngine(),
    start,
  }: {
    held?: () => HeldSettings | null
    engine?: SyncEngine
    playback?: PlaybackEngine
    start?: PlayStart
  } = {},
) {
  const Data = dataProviders({ db, engine })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={playback}>{children}</PlaybackEngineContext.Provider>
    </Data>
  )
  let renders = 0
  const view = renderHook(
    (props: Props) => {
      renders++
      return useRecordingTransport({ ...props, title: 'Cluck Old Hen', held, start })
    },
    { wrapper, initialProps: await read(id) },
  )
  return { ...view, playback, renders: () => renders }
}

describe('useRecordingTransport', () => {
  it('keeps position and playing state when the blob is replaced', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const { result, rerender } = await setup(id, { playback })
    await expect.poll(() => result.current.state.playing).toBe(true)
    act(() => playback.seek(1500))

    await storeDownloadedBlob(db, id, new Blob(['xyz']), 'audio/mp4', 'bbbbbbbb', 0)
    rerender(await read(id))
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(load.mock.calls[1]![4]).toEqual({ keepLoop: true })
    await expect.poll(() => playback.getState()).toMatchObject({ playing: true, positionMs: 1500 })
  })

  it('starts playing where it was asked to', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const { result, playback } = await setup(id, { start: { at: 1800, loop: null } })
    await expect.poll(() => result.current.state.playing).toBe(true)
    expect(playback.getState().positionMs).toBe(1800)
  })

  it("renders on a play or pause, never on the engine's position tick", async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const element = new FakeAudioElement()
    let tick = () => {}
    const clock: EngineClock = {
      every: (_ms, fn) => {
        tick = fn
        return () => {}
      },
      after: () => () => {},
    }
    const playback = fakePlaybackEngine(element as unknown as HTMLAudioElement, clock)
    const { result, renders } = await setup(id, { playback })
    await expect.poll(() => result.current.state.playing).toBe(true)
    const before = renders()
    for (const ms of [250, 500, 1250]) {
      act(() => {
        element.currentTime = ms / 1000
        tick()
      })
      await expect.poll(() => playback.getState().positionMs).toBe(ms)
    }
    expect(renders()).toBe(before)
    act(() => playback.pause())
    await expect.poll(() => result.current.state.playing).toBe(false)
    expect(renders()).toBeGreaterThan(before)
  })

  it('revokes every object url it mints, one recording after another', async () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    for (const label of ['First', 'Second']) {
      const id = await captureRecording(db, { tuneId, durationMs: 3000, label })
      const { result, unmount } = await setup(id)
      await expect.poll(() => result.current.state.playing).toBe(true)
      unmount()
    }
    const minted = create.mock.results.map((result) => result.value as string)
    expect(minted).toHaveLength(2)
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(minted)
  })

  it('keeps the loaded audio when only the label changes', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const { rerender } = await setup(id, { playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    await updateRecording(db, id, { label: 'Renamed' })
    const renamed = await read(id)
    expect(renamed.recording.label).toBe('Renamed')
    rerender(renamed)
    expect(load).toHaveBeenCalledOnce()
  })

  it('leaves a paused recording paused, at its place, when its speed changes elsewhere', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const { result, rerender } = await setup(id, { playback })
    await expect.poll(() => result.current.state.playing).toBe(true)
    act(() => {
      playback.seek(1200)
      playback.pause()
    })
    await expect.poll(() => result.current.state.playing).toBe(false)
    const { positionMs } = playback.getState()
    await updateRecording(db, id, { speed_percent: 75 })
    rerender(await read(id))
    await expect.poll(() => result.current.speedText).toBe(SPEED_BADGE(75))
    expect(playback.getState()).toMatchObject({ playing: false, positionMs })
  })

  it('plays a held speed over the row', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const held = () => ({ speedPercent: 70, pitchCents: null, isolate: null, trimming: false })
    await setup(id, { held, playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![2]).toEqual({ ...playbackSettings, speedPercent: 70 })
  })

  it('loads a recording with its stored isolate and mono flag', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const stored = { ...DEFAULT_ISOLATE, effect: 'mute' as const, lowHz: 200, highHz: 4000 }
    await updateRecording(db, id, { ...isolateToPatch(stored), is_mono: true })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    await setup(id, { playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![2]).toEqual({ ...playbackSettings, isolate: stored, isMono: true })
  })

  it('applies a stored isolate change and a measured mono flag without reloading', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const setIsolate = vi.spyOn(playback, 'setIsolate')
    const { rerender } = await setup(id, { playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    setIsolate.mockClear()

    const stored = { ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }
    await updateRecording(db, id, isolateToPatch(stored))
    rerender(await read(id))
    await expect.poll(() => setIsolate.mock.calls).toEqual([[stored, false]])

    await updateRecording(db, id, { is_mono: true })
    rerender(await read(id))
    await expect.poll(() => setIsolate.mock.calls.at(-1)).toEqual([stored, true])
    expect(load).toHaveBeenCalledOnce()
  })

  it('plays a held isolate over the row', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const isolate = { ...DEFAULT_ISOLATE, effect: 'mute' as const }
    const held = () => ({ speedPercent: null, pitchCents: null, isolate, trimming: false })
    await setup(id, { held, playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![2]).toEqual({ ...playbackSettings, isolate })
  })

  it('applies the next recording its own isolate when the dock switches', async () => {
    const first = await captureRecording(db, { tuneId, durationMs: 3000, label: 'One' })
    const second = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Two' })
    const stored = { ...DEFAULT_ISOLATE, effect: 'mute' as const, lowHz: 300 }
    await updateRecording(db, second, { ...isolateToPatch(stored), is_mono: true })
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const one = await setup(first, { playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    one.unmount()
    await setup(second, { playback })
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(load.mock.calls[1]![2]).toEqual({ ...playbackSettings, isolate: stored, isMono: true })
  })

  it('ignores an isolate held for another recording when the dock switches', async () => {
    const first = await captureRecording(db, { tuneId, durationMs: 3000, label: 'One' })
    const second = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Two' })
    const stored = { ...DEFAULT_ISOLATE, panStart: -20, panEnd: 40 }
    await updateRecording(db, second, isolateToPatch(stored))
    const playback = fakePlaybackEngine()
    const load = vi.spyOn(playback, 'load')
    const heldForFirst = { ...DEFAULT_ISOLATE, effect: 'mute' as const }
    const held = (id: string) => (): HeldSettings | null =>
      id === first
        ? { speedPercent: null, pitchCents: null, isolate: heldForFirst, trimming: false }
        : null
    // The dock keys the hook on the recording, so a switch remounts it on the shared engine.
    const one = await setup(first, { playback, held: held(first) })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![2].isolate).toEqual(heldForFirst)
    one.unmount()

    await setup(second, { playback, held: held(second) })
    await expect.poll(() => load.mock.calls.length).toBe(2)
    expect(load.mock.calls[1]![2].isolate).toEqual(stored)
  })

  it('offers a retry after a failed fetch only while online', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const id = await remoteRecording()
    const download = vi.fn(async () => null)
    const { result } = await setup(id, { engine: fakeEngine({ download }) })
    await expect.poll(() => result.current.status).toBe(DOWNLOAD_FAILED)
    expect(result.current.canRetry).toBe(true)

    // The failed fetch stays failed offline, so only the connection withholds the retry.
    onLine.mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    await expect.poll(() => result.current.status).toBe(OFFLINE)
    expect(result.current.canRetry).toBe(false)

    onLine.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    await expect.poll(() => download.mock.calls.length).toBe(2)
    await expect.poll(() => result.current.canRetry).toBe(true)
  })

  it('reads download failed after a failed fetch, and retries', async () => {
    const id = await remoteRecording()
    const download = vi.fn(async () => null)
    const { result } = await setup(id, { engine: fakeEngine({ download }) })
    await expect.poll(() => result.current.status).toBe(DOWNLOAD_FAILED)
    expect(result.current.canRetry).toBe(true)
    act(() => result.current.retry())
    await expect.poll(() => download.mock.calls.length).toBe(2)
  })

  it('turns repeat off and clears the loop', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const { result, playback } = await setup(id)
    await expect.poll(() => result.current.state.playing).toBe(true)
    act(() => {
      playback.setLoop({ id: 'loop', label: 'B part', fromS: 0.5, toS: 2.5 })
      playback.setRepeat(true)
    })
    await expect.poll(() => result.current.state.repeat).toBe(true)

    act(() => result.current.repeatOff())
    await expect.poll(() => result.current.state).toMatchObject({ repeat: false, loop: null })
  })
})
