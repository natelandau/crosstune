import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { createTune, deleteTune, updateTune } from './tunes'
import { nextUpdatedAt } from './write'

describe('nextUpdatedAt', () => {
  it('keeps the requested time for a new row or one stamped earlier', () => {
    expect(nextUpdatedAt(undefined, '2026-09-11T10:00:00.000Z')).toBe('2026-09-11T10:00:00.000Z')
    expect(nextUpdatedAt('2026-09-11T09:59:59.999Z', '2026-09-11T10:00:00.000Z')).toBe(
      '2026-09-11T10:00:00.000Z',
    )
  })

  it('moves one millisecond past a stored time that is not earlier', () => {
    expect(nextUpdatedAt('2026-09-11T10:00:00.000Z', '2026-09-11T10:00:00.000Z')).toBe(
      '2026-09-11T10:00:00.001Z',
    )
    expect(nextUpdatedAt('2026-09-11T10:00:05.000000Z', '2026-09-11T10:00:00.000Z')).toBe(
      '2026-09-11T10:00:05.001Z',
    )
  })
})

describe('writes to one row in one millisecond', () => {
  let db: CrosstuneDb

  beforeEach(() => {
    db = openTestDb()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await db.delete()
  })

  it('stamps each upsert and delete later than the last', async () => {
    const { tuneId } = await createTune(db, { title: 'v1' }, { status: 'known' })
    await updateTune(db, tuneId, { title: 'v2' })
    const updated = await db.tunes.get(tuneId)
    expect(updated?.updated_at).toBe('2026-09-11T10:00:00.001Z')
    expect((await pendingFor(db, 'tunes', tuneId))?.updated_at).toBe(updated?.updated_at)

    await deleteTune(db, tuneId)
    const deleted = await db.tunes.get(tuneId)
    expect(deleted?.updated_at).toBe('2026-09-11T10:00:00.002Z')
    expect(deleted?.deleted_at).toBe(deleted?.updated_at)
    expect((await pendingFor(db, 'tunes', tuneId))?.updated_at).toBe(deleted?.updated_at)
  })
})
