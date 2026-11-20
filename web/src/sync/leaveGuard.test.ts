import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RecordingFile, UploadHandoff } from '../db/recordings'
import type { LocalRecording } from '../db/types'
import { openTestDb } from '../test/db'
import { entitlementRow, recordingFile, recordingRow } from '../test/rows'
import { pollStill } from '../test/stillPoll'
import { pageUploadWaiting, startLeaveGuard } from './leaveGuard'

const live: UploadHandoff = {
  url: 'https://fake.r2/r1/upload',
  confirm_token: 'token',
  content_type: 'audio/mp4',
  expires_at: Date.now() + 600_000,
  attempts: 0,
}
const PREMIUM = { premium_source: 'comp' } as const

async function seed(
  file: Partial<RecordingFile>,
  { plan = PREMIUM, row = {} }: { plan?: object; row?: Partial<LocalRecording> } = {},
) {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(plan))
  await db.recordings.put(recordingRow('r1', row))
  await db.recording_files.put(recordingFile('r1', file))
  return db
}

describe('pageUploadWaiting', () => {
  it.each<[string, Partial<RecordingFile>, object, boolean, boolean]>([
    ['a captured file', {}, {}, true, true],
    ['an uploading file with no hand-off', { local_state: 'uploading' }, {}, true, true],
    ['a live hand-off', { local_state: 'uploading', handoff: live }, {}, true, false],
    ['a file blocked by quota', { local_state: 'blocked_quota' }, {}, true, false],
    ['a plan without recordings', {}, { premium_source: null }, true, false],
    ['no connection', {}, {}, false, false],
    ['an uploaded file', { local_state: 'uploaded' }, {}, true, false],
  ])('%s', async (_name, file, plan, online, expected) => {
    const db = await seed(file, { plan: { ...PREMIUM, ...plan } })
    expect(await pageUploadWaiting(db, () => online)).toBe(expected)
  })
})

describe('startLeaveGuard', () => {
  async function prevented(target: Window): Promise<boolean> {
    const event = new Event('beforeunload', { cancelable: true })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('asks before leaving only while an upload waits', async () => {
    const db = await seed({})
    const target = new EventTarget() as unknown as Window
    const stop = startLeaveGuard(db, { target, isOnline: () => true })
    try {
      await expect.poll(() => prevented(target)).toBe(true)
      await db.recording_files.update('r1', { local_state: 'uploaded' })
      await expect.poll(() => prevented(target)).toBe(false)
    } finally {
      stop()
    }
  })

  it('stops asking once stopped', async () => {
    const db = await seed({})
    const target = new EventTarget() as unknown as Window
    const stop = startLeaveGuard(db, { target, isOnline: () => true })
    try {
      await expect.poll(() => prevented(target)).toBe(true)
    } finally {
      stop()
    }
    expect(await prevented(target)).toBe(false)
  })

  it('follows the connection without a database change', async () => {
    const db = await seed({})
    const target = new EventTarget() as unknown as Window
    let online = true
    const stop = startLeaveGuard(db, { target, isOnline: () => online })
    try {
      await expect.poll(() => prevented(target)).toBe(true)
      online = false
      target.dispatchEvent(new Event('offline'))
      await expect.poll(() => prevented(target)).toBe(false)
      online = true
      target.dispatchEvent(new Event('online'))
      await expect.poll(() => prevented(target)).toBe(true)
    } finally {
      stop()
    }
  })

  it('asks again once a live hand-off expires', async () => {
    const db = await seed({
      local_state: 'uploading',
      handoff: { ...live, expires_at: Date.now() + 60_000 },
    })
    const target = new EventTarget() as unknown as Window
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    onTestFinished(() => void vi.useRealTimers())
    const scheduled = vi.spyOn(globalThis, 'setTimeout')
    const stop = startLeaveGuard(db, { target, isOnline: () => true })
    try {
      // The first evaluation has applied once it scheduled the expiry wake-up.
      await pollStill(() =>
        scheduled.mock.calls.some(([, delay]) => Number(delay) > 50_000 && Number(delay) <= 60_001),
      ).toBe(true)
      expect(await prevented(target)).toBe(false)
      vi.advanceTimersByTime(60_001)
      await pollStill(() => prevented(target)).toBe(true)
    } finally {
      stop()
    }
  })
})
