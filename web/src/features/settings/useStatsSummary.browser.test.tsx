import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { tuneRow, userTuneRow } from '../../test/rows'
import { summaryLine } from '../stats/copy'
import { useStatsSummary } from './useStatsSummary'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

describe('useStatsSummary', () => {
  it('gives the summary line and the tunes by status', async () => {
    await db.tunes.bulkPut([tuneRow('t1', 'Sally Ann'), tuneRow('t2', 'Cluck Old Hen')])
    await db.user_tunes.bulkPut([
      userTuneRow('u1', 't1', { status: 'known' }),
      userTuneRow('u2', 't2', { status: 'learning' }),
    ])
    const { result } = renderHook(() => useStatsSummary(), { wrapper: dataProviders({ db }) })
    await expect
      .poll(() => result.current?.byStatus)
      .toEqual({
        known: 1,
        learning: 1,
        want_to_learn: 0,
      })
    expect(result.current?.line).toBe(
      summaryLine({ tunes: 2, lists: 0, recordings: 0, scans: 0, ms: 0 }),
    )
  })

  it('never pulls history, which only the stats page needs', async () => {
    await db.tunes.put(tuneRow('t1', 'Sally Ann'))
    await db.user_tunes.put(userTuneRow('u1', 't1', { status: 'known' }))
    const pullEvents = vi.fn(async () => {})
    const { result } = renderHook(() => useStatsSummary(), {
      wrapper: dataProviders({ db, engine: fakeEngine({ pullEvents }) }),
    })
    await expect.poll(() => result.current?.byStatus.known).toBe(1)
    expect(pullEvents).not.toHaveBeenCalled()
  })
})
