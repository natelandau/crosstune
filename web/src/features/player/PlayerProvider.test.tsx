import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakePlaybackEngine } from '../../test/providers'
import { PlaybackEngineContext, PlaybackEngineProvider } from './PlaybackEngineProvider'
import type { PlaybackEngine } from './playbackEngine'
import { PlayerProvider } from './PlayerProvider'
import { usePlayer, type Player } from './usePlayer'

function renderPlayer(playbackEngine?: PlaybackEngine) {
  const seen: { current: Player | null } = { current: null }
  function Consumer() {
    const player = usePlayer()
    seen.current = player
    return <p>{player.item?.id ?? 'none'}</p>
  }
  const tree = (
    <PlayerProvider>
      <Consumer />
    </PlayerProvider>
  )
  render(
    playbackEngine ? (
      <PlaybackEngineContext.Provider value={playbackEngine}>{tree}</PlaybackEngineContext.Provider>
    ) : (
      <PlaybackEngineProvider>{tree}</PlaybackEngineProvider>
    ),
  )
  const player = () => {
    if (!seen.current) throw new Error('consumer did not render')
    return seen.current
  }
  return { player }
}

describe('PlayerProvider', () => {
  it('starts with nothing loaded', () => {
    renderPlayer()
    expect(screen.getByText('none')).toBeInTheDocument()
  })

  it('plays a link', () => {
    const { player } = renderPlayer()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    expect(screen.getByText('l1')).toBeInTheDocument()
  })

  it('lets play replace a loaded link', () => {
    const { player } = renderPlayer()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    act(() => player().play({ kind: 'link', id: 'l2' }))
    expect(screen.getByText('l2')).toBeInTheDocument()
  })

  it('clears the loaded link on close', () => {
    const { player } = renderPlayer()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    act(() => player().close())
    expect(screen.getByText('none')).toBeInTheDocument()
  })

  it('keeps play, close, and returnFocus stable across state changes', () => {
    const { player } = renderPlayer()
    const before = player()
    act(() => before.play({ kind: 'link', id: 'l1' }))
    const after = player()
    expect(after.play).toBe(before.play)
    expect(after.close).toBe(before.close)
    expect(after.returnFocus).toBe(before.returnFocus)
  })

  it('throws when usePlayer is used outside the provider', () => {
    expect(() => renderHook(() => usePlayer())).toThrow(
      'usePlayer must be used inside PlayerProvider',
    )
  })

  it('primes the playback engine synchronously when playing a recording', () => {
    const engine = fakePlaybackEngine()
    const prime = vi.spyOn(engine, 'prime')
    const { player } = renderPlayer(engine)
    act(() => player().play({ kind: 'recording', id: 'r1' }))
    expect(prime).toHaveBeenCalledTimes(1)
  })

  it('never primes the engine for a link, which has no AudioContext to grab early', () => {
    const engine = fakePlaybackEngine()
    const prime = vi.spyOn(engine, 'prime')
    const { player } = renderPlayer(engine)
    act(() => player().play({ kind: 'link', id: 'l1' }))
    expect(prime).not.toHaveBeenCalled()
  })
})
