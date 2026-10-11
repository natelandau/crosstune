import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakePlaybackEngine } from '../../test/providers'
import { entitlementRow } from '../../test/rows'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { PlaybackEngineContext, PlaybackEngineProvider } from './PlaybackEngineProvider'
import type { PlaybackEngine } from './playbackEngine'
import { PlayerProvider } from './PlayerProvider'
import { usePlayer, type Player } from './usePlayer'

afterEach(() => {
  vi.useRealTimers()
})

function renderPlayer(playbackEngine?: PlaybackEngine, db: CrosstuneDb = openTestDb()) {
  const seen: { current: Player | null } = { current: null }
  function Consumer() {
    const player = usePlayer()
    seen.current = player
    return (
      <>
        <p>{player.item?.id ?? 'none'}</p>
        <p>plan {usePlanOrUnknown().kind}</p>
      </>
    )
  }
  const tree = (
    <PlayerProvider>
      <Consumer />
    </PlayerProvider>
  )
  render(
    <DbContext.Provider value={db}>
      {playbackEngine ? (
        <PlaybackEngineContext.Provider value={playbackEngine}>
          {tree}
        </PlaybackEngineContext.Provider>
      ) : (
        <PlaybackEngineProvider>{tree}</PlaybackEngineProvider>
      )}
    </DbContext.Provider>,
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

  it('refuses a recording while the plan is free, and still plays a link', async () => {
    const db = openTestDb()
    await db.entitlements.put(entitlementRow())
    const engine = fakePlaybackEngine()
    const prime = vi.spyOn(engine, 'prime')
    const { player } = renderPlayer(engine, db)
    // The plan reads the shared clock the provider reads, so both see free in one commit.
    await screen.findByText('plan free')
    act(() => player().play({ kind: 'recording', id: 'r1' }))
    expect(screen.getByText('none')).toBeInTheDocument()
    expect(prime).not.toHaveBeenCalled()
    act(() => player().play({ kind: 'link', id: 'l1' }))
    expect(screen.getByText('l1')).toBeInTheDocument()
  })

  it('unloads a playing recording once the trial ends, with no sync', async () => {
    const db = openTestDb()
    await db.entitlements.put(
      entitlementRow({
        premium_source: 'trial',
        premium_expires_at: '2026-10-10T12:00:10.000Z',
        trial_ends_at: '2026-10-10T12:00:10.000Z',
      }),
    )
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
    const { player } = renderPlayer(fakePlaybackEngine(), db)
    await vi.waitFor(() => expect(screen.getByText('plan premium')).toBeInTheDocument())
    act(() => player().play({ kind: 'recording', id: 'r1' }))
    expect(screen.getByText('r1')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    await vi.waitFor(() => expect(screen.getByText('none')).toBeInTheDocument())
  })
})
