import { afterEach, expect, it } from 'vitest'
import { fakeTunerMic } from '../../test/fakeTunerMic'
import { openTunerMic } from './tunerMic'

function watchAudioSession() {
  const session = { type: 'auto' }
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
  return session
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'audioSession')
})

it('claims the audio session while open and hands it back on close', async () => {
  const session = watchAudioSession()
  const fake = fakeTunerMic()

  const mic = await openTunerMic(fake.deps)
  expect(session.type).toBe('play-and-record')

  await mic.close()
  expect(session.type).toBe('auto')
  expect(fake.openTracks()).toBe(0)
})

it('hands the session back when the microphone is refused', async () => {
  const session = watchAudioSession()
  const fake = fakeTunerMic()
  fake.getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))

  await expect(openTunerMic(fake.deps)).rejects.toThrow('Permission denied')
  expect(session.type).toBe('auto')
})

it('stops the microphone and hands the session back when the context cannot open', async () => {
  const session = watchAudioSession()
  const fake = fakeTunerMic()
  const deps = {
    ...fake.deps,
    audioContext: () => {
      throw new DOMException('No audio', 'NotSupportedError')
    },
  }

  await expect(openTunerMic(deps)).rejects.toThrow('No audio')
  expect(session.type).toBe('auto')
  expect(fake.tracks.length).toBe(1)
  expect(fake.openTracks()).toBe(0)
})
