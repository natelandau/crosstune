import { describe, expect, it } from 'vitest'
import { FakeRecorder, FakeTrack, LAST_CHUNK } from '../../test/fakeMedia'
import { createCapture } from './capture'

describe('createCapture', () => {
  it('numbers chunks in order and stops cleanly', async () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const chunks: [number, string][] = []
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async (idx, blob) => {
        chunks.push([idx, await blob.text()])
      },
      onState: () => {},
    })
    expect(recorder.timeslice).toBe(5000)
    recorder.emit('a')
    recorder.emit('b')
    await capture.stop()
    expect(chunks).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, LAST_CHUNK],
    ])
    expect(capture.state()).toBe('stopped')
    expect(track.stop).toHaveBeenCalled()
  })

  it('reports interruption from the track, not the recorder', () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const states: string[] = []
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async () => {},
      onState: (s) => states.push(s),
    })
    track.dispatchEvent(new Event('mute'))
    expect(capture.state()).toBe('interrupted')
    expect(recorder.state).toBe('recording')
    track.dispatchEvent(new Event('unmute'))
    expect(capture.state()).toBe('recording')
    expect(states).toEqual(['interrupted', 'recording'])
  })

  it('stops itself when the track ends', async () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async () => {},
      onState: () => {},
    })
    track.dispatchEvent(new Event('ended'))
    await capture.stopped
    expect(capture.state()).toBe('stopped')
  })

  it('skips empty chunks', async () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const seen: number[] = []
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async (idx) => {
        seen.push(idx)
      },
      onState: () => {},
    })
    recorder.emit('')
    recorder.emit('x')
    await capture.stop()
    expect(seen).toEqual([0, 1])
  })

  it('keeps writing later chunks after one write rejects, and stop() rejects with the error', async () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const seen: number[] = []
    const boom = new Error('boom')
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async (idx) => {
        if (idx === 1) throw boom
        seen.push(idx)
      },
      onState: () => {},
    })
    recorder.emit('a')
    recorder.emit('b')
    recorder.emit('c')
    await expect(capture.stop()).rejects.toBe(boom)
    expect(seen).toEqual([0, 2, 3])
    expect(track.stop).toHaveBeenCalled()
  })

  it('memoises stop so concurrent calls wait for the final chunk and stop the track once', async () => {
    const recorder = new FakeRecorder()
    recorder.asyncEvents = true
    const track = new FakeTrack()
    const chunks: number[] = []
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async (idx) => {
        chunks.push(idx)
      },
      onState: () => {},
    })
    await Promise.all([capture.stop(), capture.stop()])
    expect(chunks).toEqual([0])
    expect(capture.state()).toBe('stopped')
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('does not double-stop when the track ends during a manual stop', async () => {
    const recorder = new FakeRecorder()
    recorder.asyncEvents = true
    const track = new FakeTrack()
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async () => {},
      onState: () => {},
    })
    const stopping = capture.stop()
    track.dispatchEvent(new Event('ended'))
    await stopping
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('stops cleanly, with no unhandled rejection, when the track ends after a chunk write fails', async () => {
    const recorder = new FakeRecorder()
    const track = new FakeTrack()
    const boom = new Error('boom')
    const capture = createCapture(recorder, track, {
      timesliceMs: 5000,
      onChunk: async () => {
        throw boom
      },
      onState: () => {},
    })
    recorder.emit('a')
    track.dispatchEvent(new Event('ended'))
    await capture.stopped
    expect(track.stop).toHaveBeenCalled()
    await expect(capture.stop()).rejects.toBe(boom)
  })
})
