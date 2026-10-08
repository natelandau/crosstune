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
import { dataProviders, fakeEngine, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import type { HeldSettings } from '../practice/usePracticeOverlay'
import { DOWNLOAD_FAILED } from '../recording/format'
import type { PlaybackEngine } from './playbackEngine'
import { PlaybackEngineContext } from './PlaybackEngineProvider'
import { SPEED_BADGE } from './transportCopy'
import { useRecordingTransport } from './useRecordingTransport'

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
  })
  return id
}

async function setup(
  id: string,
  {
    held = () => null,
    engine = fakeEngine(),
    playback = fakePlaybackEngine(),
  }: {
    held?: () => HeldSettings | null
    engine?: SyncEngine
    playback?: PlaybackEngine
  } = {},
) {
  const Data = dataProviders({ db, engine })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={playback}>{children}</PlaybackEngineContext.Provider>
    </Data>
  )
  const view = renderHook(
    (props: Props) => useRecordingTransport({ ...props, title: 'Cluck Old Hen', held }),
    { wrapper, initialProps: await read(id) },
  )
  return { ...view, playback }
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
    const held = () => ({ speedPercent: 70, pitchCents: null, trimming: false })
    await setup(id, { held, playback })
    await expect.poll(() => load.mock.calls.length).toBe(1)
    expect(load.mock.calls[0]![2]).toEqual({ speedPercent: 70, pitchCents: 0 })
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
