import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { FakeRecorder, FakeTrack, fakeStream, LAST_CHUNK } from '../../test/fakeMedia'
import { parsePeaks } from '../waveform/peaks'
import {
  createRecordingSession,
  PARTIAL_SAVE,
  SIZE_LIMIT,
  type MediaStreamLike,
  type RecordingSessionDeps,
  type RecordingSnapshot,
} from './recordingSession'

/** A clock whose `every` timers fire in order as `advance` steps its own notion of `now`. */
function fakeTimerClock(startAt: number) {
  let time = startAt
  const timers: { ms: number; fn: () => void; next: number }[] = []
  return {
    now: () => time,
    every: (ms: number, fn: () => void) => {
      const timer = { ms, fn, next: time + ms }
      timers.push(timer)
      return () => {
        const i = timers.indexOf(timer)
        if (i >= 0) timers.splice(i, 1)
      }
    },
    advance(ms: number) {
      const end = time + ms
      for (;;) {
        const next = Math.min(...timers.map((t) => t.next))
        if (!Number.isFinite(next) || next > end) break
        time = next
        for (const timer of [...timers]) {
          if (timer.next === next) {
            timer.next += timer.ms
            timer.fn()
          }
        }
      }
      time = end
    },
  }
}

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
  Reflect.deleteProperty(navigator, 'audioSession')
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
    tuneId: null,
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
      tune_id: null,
      recorded_at: new Date(1_000).toISOString(),
    })
    expect(deps.persistStorage).toHaveBeenCalledTimes(1)
  })

  it('claims a play-and-record audio session before asking for the microphone', async () => {
    const audioSession = { type: '' }
    Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true })
    let typeWhenAsked = ''
    const { session } = setup({
      getUserMedia: vi.fn(async () => {
        typeWhenAsked = audioSession.type
        return fakeStream(new FakeTrack())
      }),
    })
    await session.start()
    expect(typeWhenAsked).toBe('play-and-record')
  })

  it('asks the microphone for one channel with processing off', async () => {
    const { session, deps } = setup()
    await session.start()
    expect(deps.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
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
      error: PARTIAL_SAVE,
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

  it('resets the audio session to auto once a recording finishes', async () => {
    const audioSession = { type: '' }
    Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true })
    const { session } = setup()
    await session.start()
    await session.finish()
    expect(audioSession.type).toBe('auto')
  })

  it('resets the audio session to auto when a recording is cancelled', async () => {
    const audioSession = { type: '' }
    Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true })
    const { session } = setup()
    await session.start()
    await session.cancel()
    expect(audioSession.type).toBe('auto')
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
    expect(session.snapshot().error).toBe(SIZE_LIMIT)
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

describe('createRecordingSession peaks', () => {
  it('records one peak per 20 ms and fits them to the duration', async () => {
    const clock = fakeTimerClock(1_000)
    const sample = 1
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(sample)),
    }
    const { session } = setup({
      clock,
      unlockAudioContext: () => ({
        createAnalyser: () => analyser as unknown as AnalyserNode,
        createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      }),
    })
    await session.start()
    expect(analyser.fftSize).toBe(1024)
    clock.advance(500)
    await session.finish()
    const file = await db.recording_files.get('rec_1')
    expect(file?.peaks_rev).toBeNull()
    const peaks = parsePeaks(file!.peaks!)
    expect(peaks.pointsPerSecond).toBe(50)
    expect(Array.from(peaks.values)).toEqual(Array.from({ length: 25 }, () => 255))
  })

  it('has no peaks when nothing was ever sampled', async () => {
    const clock = fakeTimerClock(1_000)
    const { session, recorders } = setup({ clock })
    await session.start()
    recorders[0]!.emit('early')
    await session.finish()
    expect((await db.recording_files.get('rec_1'))?.peaks).toBeNull()
  })

  it('flattens peaks to zero across an interruption, keeping sound before and after', async () => {
    const clock = fakeTimerClock(1_000)
    const analyser = {
      fftSize: 0,
      getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(1)),
    }
    const { session, track } = setup({
      clock,
      unlockAudioContext: () => ({
        createAnalyser: () => analyser as unknown as AnalyserNode,
        createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      }),
    })
    await session.start()
    clock.advance(200)
    track.dispatchEvent(new Event('mute'))
    clock.advance(200)
    track.dispatchEvent(new Event('unmute'))
    clock.advance(200)
    await session.finish()
    const file = await db.recording_files.get('rec_1')
    const peaks = parsePeaks(file!.peaks!)
    // 200 ms of sound, 200 ms of silence at the interruption, 200 ms of sound: 10 points each.
    expect(Array.from(peaks.values)).toEqual([
      ...Array<number>(10).fill(255),
      ...Array<number>(10).fill(0),
      ...Array<number>(10).fill(255),
    ])
  })
})

describe('createRecordingSession filing', () => {
  it('files the recording under the tune it was started for', async () => {
    const { session, recorders } = setup({ tuneId: 'tune_1' })
    await session.start()
    expect((await db.recording_files.get('rec_1'))?.tune_id).toBe('tune_1')
    recorders[0]!.emit('early')
    await session.finish()
    expect((await db.recordings.get('rec_1'))?.tune_id).toBe('tune_1')
    expect(session.snapshot().phase).toBe('saved')
  })
})
