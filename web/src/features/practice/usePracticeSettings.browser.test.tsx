import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import type { LocalRecording } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { DEFAULT_ISOLATE, isolateFromRow } from '../player/isolate/isolateSetting'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { usePracticeSettings } from './usePracticeSettings'

async function mount(overrides: Partial<LocalRecording> = {}) {
  const db = openTestDb()
  const recording = { ...recordingRow('rec-1'), ...overrides }
  await db.recordings.put(recording)
  const analytics = recordingAnalytics()
  const engine = fakePlaybackEngine()
  onTestFinished(() => engine.dispose())
  const data = dataProviders({ db, analytics })
  const hook = renderHook(
    () => usePracticeSettings({ recording, onError: () => {}, toast: () => {} }),
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        data({
          children: (
            <PlaybackEngineContext.Provider value={engine}>
              {children}
            </PlaybackEngineContext.Provider>
          ),
        }),
    },
  )
  return { db, analytics, hook, engine }
}

it('speed_changed bucketed, once the settled speed is written', async () => {
  const { db, analytics, hook } = await mount()
  act(() => hook.result.current.changeSpeed(90))
  act(() => hook.result.current.changeSpeed(80))
  // Leaving writes the value still settling at once.
  hook.unmount()

  await expect
    .poll(() => analytics.sends())
    .toEqual([
      { name: 'speed_changed', props: { speed_bucket: '0.75-0.99', recording_id: 'rec-1' } },
    ])
  expect((await db.recordings.get('rec-1'))?.speed_percent).toBe(80)
})

it('pitch_changed in semitones', async () => {
  const { analytics, hook } = await mount()
  act(() => hook.result.current.changePitch(-250))
  hook.unmount()

  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'pitch_changed', props: { semitones: -2.5, recording_id: 'rec-1' } }])
})

const MUTE_MID = { ...DEFAULT_ISOLATE, effect: 'mute' as const, lowHz: 200, highHz: 4000 }

it('changeIsolate applies to the engine at once and writes once it settles', async () => {
  const { db, engine, hook } = await mount()
  const setIsolate = vi.spyOn(engine, 'setIsolate')
  act(() => hook.result.current.changeIsolate(MUTE_MID))
  expect(setIsolate).toHaveBeenCalledWith(MUTE_MID, false)
  expect(hook.result.current.isolate).toEqual(MUTE_MID)
  expect(isolateFromRow((await db.recordings.get('rec-1'))!)).toEqual(DEFAULT_ISOLATE)

  hook.unmount()
  await expect
    .poll(async () => isolateFromRow((await db.recordings.get('rec-1'))!))
    .toEqual(MUTE_MID)
})

it('applies the engine the mono flag, reading an unknown one as stereo', async () => {
  const mono = await mount({ is_mono: true })
  const monoSet = vi.spyOn(mono.engine, 'setIsolate')
  act(() => mono.hook.result.current.changeIsolate(MUTE_MID))
  expect(monoSet).toHaveBeenCalledWith(MUTE_MID, true)

  const unknown = await mount({ is_mono: null })
  const unknownSet = vi.spyOn(unknown.engine, 'setIsolate')
  act(() => unknown.hook.result.current.changeIsolate(MUTE_MID))
  expect(unknownSet).toHaveBeenCalledWith(MUTE_MID, false)
})

it('isolate_changed carries buckets only, never range values', async () => {
  const { analytics, hook } = await mount()
  act(() => hook.result.current.changeIsolate({ ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }))
  act(() => hook.result.current.changeIsolate(MUTE_MID))
  hook.unmount()

  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'isolate_changed',
        props: { effect: 'mute', uses_stereo: false, uses_frequency: true, recording_id: 'rec-1' },
      },
    ])
})

it('isolate_changed reports both buckets true, and both false for an effect change alone', async () => {
  const both = await mount()
  act(() =>
    both.hook.result.current.changeIsolate({
      ...DEFAULT_ISOLATE,
      panStart: -50,
      lowHz: 200,
    }),
  )
  both.hook.unmount()
  await expect
    .poll(() => both.analytics.sends())
    .toEqual([
      {
        name: 'isolate_changed',
        props: { effect: 'solo', uses_stereo: true, uses_frequency: true, recording_id: 'rec-1' },
      },
    ])

  const neither = await mount()
  act(() => neither.hook.result.current.changeIsolate({ ...DEFAULT_ISOLATE, effect: 'mute' }))
  neither.hook.unmount()
  await expect
    .poll(() => neither.analytics.sends())
    .toEqual([
      {
        name: 'isolate_changed',
        props: { effect: 'mute', uses_stereo: false, uses_frequency: false, recording_id: 'rec-1' },
      },
    ])
})

it('isolate_changed reports a stereo range and a full frequency range', async () => {
  const { analytics, hook } = await mount()
  act(() => hook.result.current.changeIsolate({ ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }))
  hook.unmount()

  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'isolate_changed',
        props: { effect: 'solo', uses_stereo: true, uses_frequency: false, recording_id: 'rec-1' },
      },
    ])
})

it('isolate_changed reports no stereo range on a mono recording', async () => {
  const { analytics, hook } = await mount({ is_mono: true })
  act(() => hook.result.current.changeIsolate({ ...MUTE_MID, panStart: -50, panEnd: 0 }))
  hook.unmount()

  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'isolate_changed',
        props: { effect: 'mute', uses_stereo: false, uses_frequency: true, recording_id: 'rec-1' },
      },
    ])
})
