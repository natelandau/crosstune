import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEASURE_TIMEOUT_MS, measureDuration } from './measureDuration'

class FakeAudio extends EventTarget {
  duration = Number.NaN
  preload = ''
  src = ''
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
}

let audio: FakeAudio
const createAudio = () => audio as unknown as HTMLAudioElement

beforeEach(() => {
  audio = new FakeAudio()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const blob = new Blob(['audio'], { type: 'audio/mp4' })

describe('measureDuration', () => {
  it('reads the length from the metadata alone, in whole milliseconds', async () => {
    const measured = measureDuration(blob, createAudio)
    expect(audio.preload).toBe('metadata')
    expect(audio.src).toBe('blob:fake')
    audio.duration = 187.4567
    audio.dispatchEvent(new Event('loadedmetadata'))
    await expect(measured).resolves.toBe(187_457)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    expect(audio.src).toBe('')
  })

  it('measures a stream that reports no length as unknown', async () => {
    const measured = measureDuration(blob, createAudio)
    audio.duration = Number.POSITIVE_INFINITY
    audio.dispatchEvent(new Event('loadedmetadata'))
    await expect(measured).resolves.toBeNull()
  })

  it('measures a file the browser cannot read as unknown', async () => {
    const measured = measureDuration(blob, createAudio)
    audio.dispatchEvent(new Event('error'))
    await expect(measured).resolves.toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    const measured = measureDuration(blob, createAudio)
    await vi.advanceTimersByTimeAsync(MEASURE_TIMEOUT_MS)
    await expect(measured).resolves.toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })
})
