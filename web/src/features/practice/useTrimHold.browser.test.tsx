import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
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
    expect(result.current.held(id)).toEqual({ speedPercent: 100, pitchCents: 0, trimming: true })

    rerender({ trimming: false })
    await expect.poll(() => engine.getState().speedPercent).toBe(90)
    expect(engine.getState().pitchCents).toBe(-200)
    expect(result.current.held(id)).toBeNull()
  })

  it('gives back the settings a caller passes', async () => {
    const id = await captureRecording(db)
    const engine = fakePlaybackEngine()
    const settings = { speed: 80, pitch: 300 }
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
