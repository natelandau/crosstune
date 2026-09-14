import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlayerProvider } from './PlayerProvider'
import { usePlayer, type Player } from './usePlayer'

function renderPlayer() {
  const seen: { current: Player | null } = { current: null }
  function Consumer() {
    const player = usePlayer()
    seen.current = player
    return <p>{player.linkId ?? 'none'}</p>
  }
  render(
    <PlayerProvider>
      <Consumer />
    </PlayerProvider>,
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
    act(() => player().play('l1'))
    expect(screen.getByText('l1')).toBeInTheDocument()
  })

  it('lets play replace a loaded link', () => {
    const { player } = renderPlayer()
    act(() => player().play('l1'))
    act(() => player().play('l2'))
    expect(screen.getByText('l2')).toBeInTheDocument()
  })

  it('clears the loaded link on close', () => {
    const { player } = renderPlayer()
    act(() => player().play('l1'))
    act(() => player().close())
    expect(screen.getByText('none')).toBeInTheDocument()
  })

  it('keeps play, close, and returnFocus stable across state changes', () => {
    const { player } = renderPlayer()
    const before = player()
    act(() => before.play('l1'))
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
})
