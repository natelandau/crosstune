import { onTestFinished, vi, type Mock } from 'vitest'
import type { RecorderLike, TrackLike } from '../features/capture/capture'

/** The chunk a fake recorder flushes on stop(), as a real one flushes what it still holds. */
export const LAST_CHUNK = 'last'

/** A MediaRecorder stand-in. Every instance lands in `instances`; reset that per test. */
export class FakeRecorder extends EventTarget implements RecorderLike {
  static isTypeSupported = (m: string) => m === 'audio/mp4'
  static instances: FakeRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/mp4'
  timeslice: number | undefined
  /** A real recorder flips `state` synchronously on stop() but fires 'dataavailable' and
   * 'stop' on a later tick; true reproduces that gap. */
  asyncEvents = false

  constructor(
    readonly stream?: unknown,
    readonly options: MediaRecorderOptions = {},
  ) {
    super()
    FakeRecorder.instances.push(this)
  }

  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }

  stop() {
    this.state = 'inactive'
    const fire = () => {
      this.emit(LAST_CHUNK)
      this.dispatchEvent(new Event('stop'))
    }
    if (this.asyncEvents) setTimeout(fire, 0)
    else fire()
  }

  emit(text: string) {
    this.dispatchEvent(
      Object.assign(new Event('dataavailable'), { data: new Blob([text], { type: 'audio/mp4' }) }),
    )
  }
}

export class FakeTrack extends EventTarget implements TrackLike {
  muted = false
  stop = vi.fn()
}

export function fakeStream(track: FakeTrack) {
  return { getAudioTracks: () => [track], getTracks: () => [track] }
}

/** Stub every browser global a recording touches, handing out one microphone track. */
function stubMediaGlobals(): { track: FakeTrack; getUserMedia: Mock } {
  const track = new FakeTrack()
  FakeRecorder.instances = []
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      resume = vi.fn(async () => {})
      suspend = vi.fn(async () => {})
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
      createAnalyser = () => ({
        fftSize: 0,
        frequencyBinCount: 16,
        getByteTimeDomainData: vi.fn(),
        getFloatTimeDomainData: vi.fn(),
      })
    },
  )
  const getUserMedia = vi.fn(async () => fakeStream(track))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist: vi.fn(async () => true) },
  })
  return { track, getUserMedia }
}

/**
 * `stubMediaGlobals` for one test, putting every global it touches back when the test ends.
 * `navigator.mediaDevices` and `navigator.storage` are defined properties, which
 * `vi.unstubAllGlobals()` does not restore.
 */
export function fakeMediaForTest(): { track: FakeTrack; getUserMedia: Mock } {
  const owned = (['mediaDevices', 'storage'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
  )
  onTestFinished(() => {
    vi.unstubAllGlobals()
    for (const [key, descriptor] of owned) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor)
      else Reflect.deleteProperty(navigator, key)
    }
  })
  return stubMediaGlobals()
}
