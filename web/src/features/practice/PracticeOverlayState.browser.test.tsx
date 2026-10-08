import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { ListHoldContext } from '../player/useListPlayback'
import { PlayerProvider } from '../player/PlayerProvider'
import { usePlayer } from '../player/usePlayer'
import { PracticeOverlayStateProvider } from './PracticeOverlayState'
import { usePracticeOverlay, usePracticeOverlayShown } from './usePracticeOverlay'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(reportHolding: (recordingId: string | null) => void = () => {}) {
  const Data = dataProviders({ db })
  const engine = fakePlaybackEngine()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={engine}>
        <PlayerProvider>
          <ListHoldContext.Provider value={reportHolding}>
            <PracticeOverlayStateProvider>{children}</PracticeOverlayStateProvider>
          </ListHoldContext.Provider>
        </PlayerProvider>
      </PlaybackEngineContext.Provider>
    </Data>
  )
  return renderHook(
    () => ({
      overlay: usePracticeOverlay(),
      ...usePracticeOverlayShown(),
      player: usePlayer(),
    }),
    { wrapper },
  )
}

describe('PracticeOverlayStateProvider', () => {
  it('plays a recording the player has not loaded when it opens', async () => {
    const id = await captureRecording(db)
    const { result } = setup()
    act(() => result.current.overlay.open(id))
    await expect.poll(() => result.current.player.item).toEqual({ kind: 'recording', id })
    await expect.poll(() => result.current.shown).toEqual({ id, open: true, opening: 1 })
  })

  it('closes when the player loads another item', async () => {
    const id = await captureRecording(db)
    const other = await captureRecording(db)
    const { result } = setup()
    act(() => result.current.overlay.open(id))
    await expect.poll(() => result.current.shown?.open).toBe(true)
    act(() => result.current.player.play({ kind: 'recording', id: other }))
    await expect.poll(() => result.current.shown).toEqual({ id, open: false, opening: 1 })
  })

  it('tells the list of a trim hold within the call that makes it', () => {
    const reported: (string | null)[] = []
    const { result } = setup((id) => reported.push(id))
    const { overlay } = result.current
    overlay.hold('r1', { speedPercent: 100, pitchCents: 0, trimming: true })
    expect(reported.at(-1)).toBe('r1')
    overlay.hold('r1', null)
    expect(reported.at(-1)).toBeNull()
  })

  it('tells the list of a sheet hold within the call that makes it, behind a trim hold', () => {
    const reported: (string | null)[] = []
    const { result } = setup((id) => reported.push(id))
    const { overlay } = result.current
    overlay.holdEnd('r1', true)
    expect(reported.at(-1)).toBe('r1')
    overlay.hold('r2', { speedPercent: 100, pitchCents: 0, trimming: true })
    expect(reported.at(-1)).toBe('r2')
    overlay.hold('r2', null)
    expect(reported.at(-1)).toBe('r1')
    overlay.holdEnd('r1', false)
    expect(reported.at(-1)).toBeNull()
  })

  it('forgets practice once it is dismissed after closing', async () => {
    const id = await captureRecording(db)
    const { result } = setup()
    act(() => result.current.overlay.open(id))
    act(() => result.current.overlay.close())
    await expect.poll(() => result.current.shown?.open).toBe(false)
    act(() => result.current.dismissed())
    await expect.poll(() => result.current.shown).toBeNull()
  })
})
