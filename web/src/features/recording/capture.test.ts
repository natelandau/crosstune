import { describe, expect, it, vi } from 'vitest'
import { createCapture, type RecorderLike, type TrackLike } from './capture'

class FakeRecorder extends EventTarget implements RecorderLike {
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/mp4'
  timeslice: number | undefined
  // Real MediaRecorder flips `state` to 'inactive' synchronously on stop() but fires its
  // 'dataavailable'/'stop' events on a later tick; the async flag reproduces that gap.
  constructor(private asyncEvents = false) {
    super()
  }
  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }
  stop() {
    this.state = 'inactive'
    const fire = () => {
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['last']) }))
      this.dispatchEvent(new Event('stop'))
    }
    if (this.asyncEvents) setTimeout(fire, 0)
    else fire()
  }
  emit(text: string) {
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([text]) }))
  }
}

class FakeTrack extends EventTarget implements TrackLike {
  muted = false
  stop = vi.fn()
}

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
      [2, 'last'],
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
    const recorder = new FakeRecorder(true)
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
    const recorder = new FakeRecorder(true)
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
