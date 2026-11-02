import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { updateRecording } from '../../commands/recordings'
import { DEFAULT_ISOLATE, isolateToPatch } from '../player/isolate/isolateSetting'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { PlayerProvider } from '../player/PlayerProvider'
import { PracticeOverlayStateProvider } from './PracticeOverlayState'
import { usePracticeOverlay } from './usePracticeOverlay'
import { useTrimHold } from './useTrimHold'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(engine: ReturnType<typeof fakePlaybackEngine>) {
  const Data = dataProviders({ db })
  return ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={engine}>
        <PlayerProvider>
          <PracticeOverlayStateProvider>{children}</PracticeOverlayStateProvider>
        </PlayerProvider>
      </PlaybackEngineContext.Provider>
    </Data>
  )
}

describe('useTrimHold', () => {
  it('plays at 100% and no shift while trimming, then gives back the row settings', async () => {
    const id = await captureRecording(db, { speed_percent: 90, pitch_cents: -200 })
    const engine = fakePlaybackEngine()
    engine.setSpeed(90)
    engine.setPitch(-200)
    const wrapper = setup(engine)
    const { result, rerender } = renderHook(
      ({ trimming }: { trimming: boolean }) => {
        useTrimHold(id, trimming)
        return usePracticeOverlay()
      },
      { wrapper, initialProps: { trimming: false } },
    )
    rerender({ trimming: true })
    await expect.poll(() => engine.getState().speedPercent).toBe(100)
    expect(engine.getState().pitchCents).toBe(0)
    expect(result.current.held(id)).toEqual({
      speedPercent: 100,
      pitchCents: 0,
      isolate: DEFAULT_ISOLATE,
      trimming: true,
    })

    rerender({ trimming: false })
    await expect.poll(() => engine.getState().speedPercent).toBe(90)
    expect(engine.getState().pitchCents).toBe(-200)
    expect(result.current.held(id)).toBeNull()
  })

  it('plays the default isolate while trimming, then gives back the row setting', async () => {
    const stored = { ...DEFAULT_ISOLATE, effect: 'mute' as const, lowHz: 200, highHz: 4000 }
    const id = await captureRecording(db)
    await updateRecording(db, id, { ...isolateToPatch(stored), is_mono: true })
    const engine = fakePlaybackEngine()
    engine.setIsolate(stored, true)
    expect(engine.getState().isolateDefault).toBe(false)
    const setIsolate = vi.spyOn(engine, 'setIsolate')
    const { rerender } = renderHook(
      ({ trimming }: { trimming: boolean }) => useTrimHold(id, trimming),
      { wrapper: setup(engine), initialProps: { trimming: false } },
    )
    rerender({ trimming: true })
    await expect.poll(() => engine.getState().isolateDefault).toBe(true)
    expect(setIsolate).toHaveBeenLastCalledWith(DEFAULT_ISOLATE, true)

    rerender({ trimming: false })
    await expect.poll(() => engine.getState().isolateDefault).toBe(false)
    expect(setIsolate).toHaveBeenLastCalledWith(stored, true)
  })

  it('gives back the settings a caller passes', async () => {
    const id = await captureRecording(db)
    const engine = fakePlaybackEngine()
    const settings = { speed: 80, pitch: 300, isolate: DEFAULT_ISOLATE, isMono: false }
    const { rerender } = renderHook(
      ({ trimming }: { trimming: boolean }) => useTrimHold(id, trimming, settings),
      { wrapper: setup(engine), initialProps: { trimming: false } },
    )
    rerender({ trimming: true })
    await expect.poll(() => engine.getState().speedPercent).toBe(100)
    expect(engine.getState().pitchCents).toBe(0)

    rerender({ trimming: false })
    await expect.poll(() => engine.getState().speedPercent).toBe(80)
    expect(engine.getState().pitchCents).toBe(300)
  })
})
