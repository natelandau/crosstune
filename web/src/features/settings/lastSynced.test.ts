import { describe, expect, it } from 'vitest'
import { JUST_NOW, lastSyncedLabel, NOT_SYNCED_YET, syncedLine } from './lastSynced'

const NOW = Date.parse('2025-03-04T12:00:00.000Z')
const before = (ms: number) => new Date(NOW - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('lastSyncedLabel', () => {
  it('says not synced yet before the first sync', () => {
    expect(lastSyncedLabel(null, NOW)).toBe(NOT_SYNCED_YET)
  })

  it('reads just now under a minute, and for a time ahead of the clock', () => {
    expect(lastSyncedLabel(before(59_000), NOW)).toBe(JUST_NOW)
    expect(lastSyncedLabel(before(-5 * MINUTE), NOW)).toBe(JUST_NOW)
  })

  it('counts minutes, then hours, then days', () => {
    expect(lastSyncedLabel(before(2 * MINUTE + 30_000), NOW)).toBe('2 min ago')
    expect(lastSyncedLabel(before(59 * MINUTE), NOW)).toBe('59 min ago')
    expect(lastSyncedLabel(before(HOUR), NOW)).toBe('1 hr ago')
    expect(lastSyncedLabel(before(23 * HOUR), NOW)).toBe('23 hr ago')
    expect(lastSyncedLabel(before(DAY), NOW)).toBe('1 day ago')
    expect(lastSyncedLabel(before(40 * DAY), NOW)).toBe('40 days ago')
  })

  it('reads an unparsable time as never synced', () => {
    expect(lastSyncedLabel('not a time', NOW)).toBe(NOT_SYNCED_YET)
  })
})

describe('syncedLine', () => {
  it('puts the time in a sentence', () => {
    expect(syncedLine(before(2 * MINUTE), NOW)).toBe('Synced 2 min ago')
    expect(syncedLine(before(1_000), NOW)).toBe('Synced just now')
    expect(syncedLine(null, NOW)).toBe(NOT_SYNCED_YET)
  })
})
