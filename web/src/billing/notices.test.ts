import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { openTestDb } from '../test/db'
import { createFakeApi } from '../test/fakeApi'
import { entitlementRow } from '../test/rows'
import { dueUnseenNotice, markNoticeSeen, postSeenNotices, seenNotices } from './notices'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const DAY = 86_400_000
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const NONE = new Set<never>()

describe('dueUnseenNotice', () => {
  it('shows a comp account nothing once its trial has ended', () => {
    const row = entitlementRow({ premium_source: 'comp', trial_ends_at: at(-DAY) })
    expect(dueUnseenNotice(row, NOW, true, NONE)).toBeNull()
  })

  it('shows nothing once the row carries the trial end as seen', () => {
    const row = entitlementRow({ trial_ends_at: at(-DAY), trial_end_seen_at: at(-DAY / 2) })
    expect(dueUnseenNotice(row, NOW, false, NONE)).toBeNull()
  })

  it('passes over a notice seen on this device to the next one due', () => {
    const row = entitlementRow({
      premium_source: 'trial',
      premium_expires_at: at(2 * DAY),
      trial_ends_at: at(2 * DAY),
    })
    expect(dueUnseenNotice(row, NOW, true, NONE)).toBe('trial_reminder')
    expect(dueUnseenNotice(row, NOW, true, new Set(['trial_reminder'] as const))).toBe(
      'first_recording',
    )
    expect(
      dueUnseenNotice(row, NOW, true, new Set(['trial_reminder', 'first_recording'] as const)),
    ).toBeNull()
  })

  it('shows nothing with no row', () => {
    expect(dueUnseenNotice(null, NOW, true, NONE)).toBeNull()
  })
})

describe('postSeenNotices', () => {
  it('rethrows an auth failure in preference to an earlier one', async () => {
    const db = openTestDb()
    await markNoticeSeen(db, 'first_recording')
    await markNoticeSeen(db, 'trial_reminder')
    const fake = createFakeApi()
    const failures = [new ApiError(500, null), new ApiError(401, null)]
    const api = { ...fake.api, recordNotice: async () => Promise.reject(failures.shift()) }

    await expect(postSeenNotices(db, api)).rejects.toSatisfy(
      (error) => error instanceof ApiError && error.status === 401,
    )
    expect(await seenNotices(db)).toEqual(new Set(['first_recording', 'trial_reminder']))
  })
})
