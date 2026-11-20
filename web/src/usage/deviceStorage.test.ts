import { describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { recordingFile } from '../test/rows'
import { reportDeviceStorage } from './deviceStorage'
import { recordingAnalytics } from './testing'

describe('reportDeviceStorage', () => {
  it('reports whether the browser keeps the data, the recordings only here, and the room left', async () => {
    const db = openTestDb()
    await db.recording_files.bulkPut([
      recordingFile('waiting', { local_state: 'captured' }),
      recordingFile('blocked', { local_state: 'blocked_quota' }),
      recordingFile('sent', { local_state: 'uploaded' }),
    ])
    const analytics = recordingAnalytics()
    await reportDeviceStorage(db, analytics, {
      persisted: async () => false,
      headroom: async () => 5_000_000,
    })
    expect(analytics.sends()).toEqual([
      {
        name: 'device_storage_checked',
        props: { storage_persisted: false, recordings_waiting: '1-9', storage_free: '<10MB' },
      },
    ])
  })

  type Persisted = () => Promise<boolean> | undefined
  type Headroom = () => Promise<number | null>
  it.each<[string, Persisted, Headroom]>([
    ['whether it keeps the data', () => undefined, async () => 1],
    ['how much room is left', async () => true, async () => null],
  ])('sends nothing when the browser does not say %s', async (_, persisted, headroom) => {
    const analytics = recordingAnalytics()
    await reportDeviceStorage(openTestDb(), analytics, { persisted, headroom })
    expect(analytics.sends()).toEqual([])
  })
})
