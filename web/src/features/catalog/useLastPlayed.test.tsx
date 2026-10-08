import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { playEventRow } from '../../test/rows'
import { useLastPlayed } from './useLastPlayed'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(enabled: boolean) {
  const pullEvents = vi.fn(async () => {})
  const wrapper = dataProviders({ db, engine: fakeEngine({ pullEvents }) })
  const hook = renderHook((props: { enabled: boolean }) => useLastPlayed(props.enabled), {
    wrapper,
    initialProps: { enabled },
  })
  return { ...hook, pullEvents }
}

describe('useLastPlayed', () => {
  it('leaves the history on the server until the last-played sort asks for it', async () => {
    const { result, rerender, pullEvents } = setup(false)
    expect(result.current.size).toBe(0)
    expect(pullEvents).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(pullEvents).toHaveBeenCalledOnce())
  })

  it('reads each tune’s latest play, and follows plays as they land', async () => {
    await db.play_events.put(
      playEventRow('p1', { tune_id: 't1', started_at: '2026-01-01T12:00:00.000Z' }),
    )
    const { result } = setup(true)
    await waitFor(() => expect(result.current.get('t1')).toBe(Date.parse('2026-01-01T12:00:00Z')))
    await db.play_events.put(
      playEventRow('p2', { tune_id: 't1', started_at: '2026-02-01T12:00:00.000Z' }),
    )
    await waitFor(() => expect(result.current.get('t1')).toBe(Date.parse('2026-02-01T12:00:00Z')))
  })

  it('keeps the stored history when the pull fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.play_events.put(playEventRow('p1', { tune_id: 't1' }))
    const pullEvents = vi.fn(async () => {
      throw new Error('offline')
    })
    const { result } = renderHook(() => useLastPlayed(true), {
      wrapper: dataProviders({ db, engine: fakeEngine({ pullEvents }) }),
    })
    await waitFor(() => expect(result.current.has('t1')).toBe(true))
    expect(pullEvents).toHaveBeenCalledOnce()
  })
})
