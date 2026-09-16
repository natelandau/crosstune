import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { FakeRecorder, FakeTrack, fakeStream, LAST_CHUNK } from '../../test/fakeMedia'
import {
  createRecordingSession,
  type MediaStreamLike,
  type RecordingSessionDeps,
  type RecordingSnapshot,
} from './recordingSession'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function setup(overrides: Partial<RecordingSessionDeps<MediaStreamLike>> = {}) {
  const track = new FakeTrack()
  const stream: MediaStreamLike = fakeStream(track)
  FakeRecorder.instances = []
  const recorders = FakeRecorder.instances
  const clock = { time: 1_000 }
  const releaseLock = vi.fn()
  const releaseWakeLock = vi.fn()
  const deps: RecordingSessionDeps<MediaStreamLike> = {
    db,
    userId: 'user_1',
    recordingId: 'rec_1',
    getUserMedia: vi.fn(async () => stream),
    MediaRecorder: FakeRecorder,
    acquireCaptureLock: vi.fn(async () => releaseLock),
    holdWakeLock: vi.fn(() => releaseWakeLock),
    unlockAudioContext: () => ({
      createAnalyser: () => ({ fftSize: 0 }) as AnalyserNode,
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    }),
    suspendAudioContext: vi.fn(),
    persistStorage: vi.fn(),
    clock: { now: () => clock.time, every: () => () => {} },
    ...overrides,
  }
  const session = createRecordingSession(deps)
  const snapshots: RecordingSnapshot[] = []
  session.subscribe((s) => snapshots.push(s))
  return { session, deps, stream, track, recorders, releaseLock, releaseWakeLock, clock, snapshots }
}

describe('createRecordingSession start sequence', () => {
  it('backs out when disposed during the settings read', async () => {
    const { session, deps, releaseWakeLock } = setup()
    const started = session.start()
    session.dispose()
    await started
    expect(deps.getUserMedia).not.toHaveBeenCalled()
    expect(releaseWakeLock).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.count()).toBe(0)
  })

  it('stops a stream granted after being disposed and never takes the lock', async () => {
    const grant = deferred<MediaStreamLike>()
    const { session, deps, stream, track, recorders } = setup({
      getUserMedia: vi.fn(() => grant.promise),
    })
    const started = session.start()
    await vi.waitFor(() => expect(deps.getUserMedia).toHaveBeenCalled())
    session.dispose()
    grant.resolve(stream)
    await started
    expect(track.stop).toHaveBeenCalled()
    expect(deps.acquireCaptureLock).not.toHaveBeenCalled()
    expect(recorders).toHaveLength(0)
  })

  it('releases a lock granted after being disposed', async () => {
    const lock = deferred<() => void>()
    const { session, deps, track, recorders, releaseLock } = setup({
      acquireCaptureLock: vi.fn(() => lock.promise),
    })
    const started = session.start()
    await vi.waitFor(() => expect(deps.acquireCaptureLock).toHaveBeenCalled())
    session.dispose()
    lock.resolve(releaseLock)
    await started
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalled()
    expect(recorders).toHaveLength(0)
    expect(await db.recording_files.count()).toBe(0)
  })

  it('removes the capture row when cancelled while it is being written', async () => {
    const put = db.recording_files.put.bind(db.recording_files)
    const { session, deps, track, recorders, releaseLock } = setup()
    vi.spyOn(db.recording_files, 'put').mockImplementationOnce((file) => {
      void session.cancel()
      return put(file)
    })
    await session.start()
    await vi.waitFor(async () => expect(await db.recording_files.count()).toBe(0))
    expect(recorders[0]?.state).toBe('inactive')
    expect(track.stop).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(deps.persistStorage).not.toHaveBeenCalled()
    expect(session.snapshot().phase).toBe('starting')
  })

  it('reports a denied microphone without taking the lock or asking for storage', async () => {
    const { session, deps } = setup({
      getUserMedia: vi.fn(() =>
        Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
      ),
    })
    await session.start()
    expect(session.snapshot()).toMatchObject({ phase: 'denied' })
    expect(session.snapshot().error).toContain('microphone')
    expect(deps.acquireCaptureLock).not.toHaveBeenCalled()
    expect(deps.persistStorage).not.toHaveBeenCalled()
  })

  it('takes the lock before the capture row and asks for storage once recording', async () => {
    const { session, deps, snapshots } = setup()
    const put = vi.spyOn(db.recording_files, 'put')
    await session.start()
    expect(session.snapshot().phase).toBe('recording')
    expect(snapshots.at(-1)?.phase).toBe('recording')
    const [lockAt] = vi.mocked(deps.acquireCaptureLock).mock.invocationCallOrder
    const [rowAt] = put.mock.invocationCallOrder
    expect(lockAt).toBeLessThan(rowAt!)
    expect(await db.recording_files.get('rec_1')).toMatchObject({
      local_state: 'capturing',
      song_id: null,
      recorded_at: new Date(1_000).toISOString(),
    })
    expect(deps.persistStorage).toHaveBeenCalledTimes(1)
  })
})

describe('createRecordingSession finish and cancel', () => {
  it('keeps a recording with a failed chunk write and warns about it', async () => {
    const { session, track, recorders, releaseLock, releaseWakeLock } = setup()
    await session.start()
    vi.spyOn(db.recording_chunks, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'))
    recorders[0]!.emit('early')
    await session.finish()
    expect(session.snapshot()).toMatchObject({
      phase: 'saved',
      error: 'Part of this recording could not be saved.',
    })
    const file = await db.recording_files.get('rec_1')
    expect(file).toMatchObject({ local_state: 'captured', bytes: LAST_CHUNK.length })
    expect(track.stop).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(releaseWakeLock).toHaveBeenCalledTimes(1)
  })

  it('discards the recording on cancel and releases everything once', async () => {
    const { session, deps, track, releaseLock, releaseWakeLock } = setup()
    await session.start()
    await session.cancel()
    await session.cancel()
    expect(await db.recording_files.count()).toBe(0)
    expect(await db.recording_chunks.count()).toBe(0)
    expect(await db.recordings.count()).toBe(0)
    expect(track.stop).toHaveBeenCalled()
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(releaseWakeLock).toHaveBeenCalledTimes(1)
    expect(deps.suspendAudioContext).toHaveBeenCalledTimes(1)
  })

  it('suspends the shared audio context once a recording finishes', async () => {
    const { session, deps } = setup()
    await session.start()
    await session.finish()
    expect(deps.suspendAudioContext).toHaveBeenCalledTimes(1)
  })

  it('finishes and keeps a recording that is still running when disposed', async () => {
    const { session, releaseLock } = setup()
    await session.start()
    session.dispose()
    await vi.waitFor(() => expect(releaseLock).toHaveBeenCalled())
    expect((await db.recording_files.get('rec_1'))?.local_state).toBe('captured')
    expect(await db.recordings.count()).toBe(1)
  })

  it('stops and keeps a recording once it nears the per-file size limit', async () => {
    await setStorage(db, { used_bytes: 0, quota_bytes: 1_000, max_file_bytes: 20 })
    const { session, recorders, releaseLock } = setup()
    await session.start()
    recorders[0]!.emit('0123456789')
    await vi.waitFor(async () => expect(await db.recording_chunks.count()).toBe(1))
    expect(session.snapshot().phase).toBe('recording')
    recorders[0]!.emit('0123456789')
    await vi.waitFor(() => expect(session.snapshot().phase).toBe('saved'))
    expect(session.snapshot().error).toBe('This recording reached the size limit and was saved.')
    expect(recorders[0]?.state).toBe('inactive')
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect((await db.recording_files.get('rec_1'))?.local_state).toBe('captured')
  })

  it('never stops a recording for size when no storage figures are cached', async () => {
    const { session, recorders } = setup()
    await session.start()
    recorders[0]!.emit('x'.repeat(10_000))
    await vi.waitFor(async () => expect(await db.recording_chunks.count()).toBe(1))
    expect(session.snapshot().phase).toBe('recording')
    await session.finish()
    expect(session.snapshot().error).toBeNull()
  })

  it('counts interrupted time in the duration, since the recorder keeps running muted, and stamps the start', async () => {
    const { session, track, clock } = setup()
    await session.start()
    clock.time += 2_000
    track.dispatchEvent(new Event('mute'))
    expect(session.snapshot()).toMatchObject({ phase: 'interrupted', elapsedMs: 2_000 })
    clock.time += 7_000
    track.dispatchEvent(new Event('unmute'))
    clock.time += 1_000
    track.dispatchEvent(new Event('mute'))
    expect(session.snapshot().elapsedMs).toBe(10_000)
    clock.time += 9_000
    track.dispatchEvent(new Event('unmute'))
    clock.time += 4_000
    await session.finish()
    expect(session.snapshot()).toMatchObject({ phase: 'saved', elapsedMs: 23_000 })
    expect((await db.recording_files.get('rec_1'))?.local_duration_ms).toBe(23_000)
    expect((await db.recordings.get('rec_1'))?.recorded_at).toBe(new Date(1_000).toISOString())
  })
})
