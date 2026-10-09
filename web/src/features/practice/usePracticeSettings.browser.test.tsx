import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, onTestFinished } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { usePracticeSettings } from './usePracticeSettings'

async function mount() {
  const db = openTestDb()
  const recording = recordingRow('rec-1')
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
  return { db, analytics, hook }
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
