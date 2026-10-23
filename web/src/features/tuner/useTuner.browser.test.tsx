import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { fakeTunerMic } from '../../test/fakeTunerMic'
import { synthesize, type ClipRecipe } from '../../test/synthesize'
import { TUNER_FFT_SIZE } from './tunerMic'
import { useTuner, type TunerState } from './useTuner'

const noteOf = (state: TunerState) =>
  state.status === 'listening' ? state.reading?.note : undefined

const gesture = (type: 'pointerdown' | 'keydown') =>
  act(() => {
    document.body.dispatchEvent(
      type === 'keydown'
        ? new KeyboardEvent(type, { bubbles: true, key: 'a' })
        : new PointerEvent(type, { bubbles: true }),
    )
  })

function mount(fake: ReturnType<typeof fakeTunerMic>, active = true) {
  return renderHook(
    ({ on }: { on: boolean }) => useTuner({ active: on, a4: 440, deps: fake.deps }),
    { initialProps: { on: active } },
  )
}

const A440: ClipRecipe = {
  id: 'a440',
  sampleRate: 48_000,
  seconds: 0.6,
  a4: 440,
  f0: 440,
  partials: [
    [1, 1],
    [2, 0.6],
    [3, 0.4],
  ],
  amplitude: 0.2,
  decaySeconds: null,
  noiseDbfs: -60,
  hum: null,
  expect: { name: 'A', octave: 4, cents: 0 },
}

it('opens one mic while active and none after', async () => {
  const fake = fakeTunerMic()
  const { rerender, unmount } = mount(fake)
  rerender({ on: false })
  rerender({ on: true })

  await expect.poll(() => fake.openTracks()).toBe(1)
  await expect.poll(() => fake.getUserMedia.mock.calls.length).toBe(1)
  rerender({ on: false })
  await expect.poll(() => fake.openTracks()).toBe(0)
  rerender({ on: true })
  await expect.poll(() => fake.getUserMedia.mock.calls.length).toBe(2)
  await expect.poll(() => fake.openTracks()).toBe(1)
  unmount()
  await expect.poll(() => fake.openTracks()).toBe(0)
  expect(fake.mostOpen()).toBe(1)
})

it('reports denied on NotAllowedError', async () => {
  const fake = fakeTunerMic()
  fake.getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('denied')
})

it('reports unavailable when no microphone is found', async () => {
  const fake = fakeTunerMic()
  fake.getUserMedia.mockRejectedValue(new DOMException('Not found', 'NotFoundError'))
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('unavailable')
})

it('reports unavailable when the track ends mid-session', async () => {
  const fake = fakeTunerMic()
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('listening')
  act(() => {
    fake.tracks[0]!.dispatchEvent(new Event('ended'))
  })
  await expect.poll(() => result.current.status).toBe('unavailable')
})

it('reads A4 from a synthesized A440 tone', async () => {
  const fake = fakeTunerMic()
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('listening')
  fake.play(synthesize(A440, 0, 1))
  await expect
    .poll(() => {
      const state = result.current
      return state.status === 'listening' ? state.reading?.note : undefined
    })
    .toMatchObject({ name: 'A', octave: 4 })
  const state = result.current
  if (state.status !== 'listening' || !state.reading) throw new Error('no reading')
  expect(Math.abs(state.reading.note.cents)).toBeLessThan(0.5)
})

it('closes the mic when the track ends', async () => {
  const fake = fakeTunerMic()
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('listening')
  act(() => {
    fake.tracks[0]!.dispatchEvent(new Event('ended'))
  })
  await expect.poll(() => fake.openTracks()).toBe(0)
})

it('waits for a tap when the context starts suspended', async () => {
  const fake = fakeTunerMic({ contextState: 'suspended' })
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('paused')

  gesture('pointerdown')

  await expect.poll(() => result.current.status).toBe('listening')
  fake.play(synthesize(A440, 0, 1))
  await expect.poll(() => noteOf(result.current)).toMatchObject({ name: 'A', octave: 4 })
})

it('pauses while interrupted and resumes on a key', async () => {
  const fake = fakeTunerMic()
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('listening')

  fake.context()!.become('interrupted')
  await expect.poll(() => result.current.status).toBe('paused')
  gesture('keydown')

  await expect.poll(() => result.current.status).toBe('listening')
})

it('starts afresh after a stall longer than the analyser holds', async () => {
  const fake = fakeTunerMic()
  const { result } = mount(fake)
  await expect.poll(() => result.current.status).toBe('listening')
  fake.play(synthesize(A440, 0, 1))
  await expect.poll(() => noteOf(result.current)).toMatchObject({ name: 'A', octave: 4 })

  // Less silence than the tracker holds a reading through, but not joined to the tone.
  fake.stall(2 * TUNER_FFT_SIZE)
  fake.play(new Float32Array(1))

  await expect.poll(() => noteOf(result.current)).toBeUndefined()
})
