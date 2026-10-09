import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fakePlayer } from '../../test/providers'
import { PlayerContext, type Player } from '../player/usePlayer'
import * as audioContext from './audioContext'
import { RecordStateProvider, useRecordState } from './RecordState'

vi.mock('./audioContext', { spy: true })

function setup(player: Player = fakePlayer()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlayerContext.Provider value={player}>
      <RecordStateProvider>{children}</RecordStateProvider>
    </PlayerContext.Provider>
  )
  return renderHook(() => useRecordState(), { wrapper })
}

describe('RecordStateProvider', () => {
  it('opens for a tune, unlocking audio and closing the player inside the tap', () => {
    const player = fakePlayer()
    const unlock = vi.mocked(audioContext.unlockAudioContext)
    unlock.mockClear()
    const { result } = setup(player)
    expect(result.current.target).toBeNull()

    act(() => result.current.start({ tuneId: 't1', source: 'tune' }))

    expect(result.current.target).toEqual({ tuneId: 't1', source: 'tune' })
    expect(result.current.recording).toBe(true)
    expect(unlock).toHaveBeenCalledOnce()
    expect(player.close).toHaveBeenCalledOnce()
  })

  it('ignores a second start while one is live', () => {
    const player = fakePlayer()
    const { result } = setup(player)

    act(() => {
      result.current.start({ tuneId: 't1', source: 'tune' })
      result.current.start({ tuneId: 't2', source: 'tune' })
    })
    act(() => result.current.start({ source: 'dock' }))

    expect(result.current.target).toEqual({ tuneId: 't1', source: 'tune' })
    expect(player.close).toHaveBeenCalledOnce()
  })

  it('remembers the last save when it closes, and starts again after', () => {
    const { result } = setup()
    expect(result.current.lastSaved).toBeNull()
    act(() => result.current.start({ tuneId: 't1', source: 'tune' }))

    act(() => result.current.close({ recordingId: 'r1' }))

    expect(result.current.target).toBeNull()
    expect(result.current.lastSaved).toEqual({ recordingId: 'r1', at: expect.any(Number) })

    act(() => result.current.start({ source: 'dock' }))
    expect(result.current.target).toEqual({ tuneId: null, source: 'dock' })
    act(() => result.current.close())
    // A discarded take leaves the last save standing.
    expect(result.current.lastSaved?.recordingId).toBe('r1')
  })
})
