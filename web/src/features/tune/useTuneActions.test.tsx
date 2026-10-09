import { renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import { recordingAnalytics } from '../../usage/testing'
import { createTune } from '../../commands/tunes'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { linkRow, recordingRow, scanRow } from '../../test/rows'
import { useTuneActions } from './useTuneActions'

async function setup() {
  const db = openTestDb()
  const analytics = recordingAnalytics()
  const ids = await createTune(db, { title: 'Soldier' }, { status: 'known' })
  const { result } = renderHook(() => useTuneActions(), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { db, analytics, ids, actions: result }
}

it('reports archive and unarchive with the tune id', async () => {
  const { analytics, ids, actions } = await setup()
  await actions.current.archive(ids, true)
  await actions.current.archive(ids, false)
  expect(analytics.sends()).toEqual([
    { name: 'tune_archived', props: { tune_id: ids.tuneId } },
    { name: 'tune_unarchived', props: { tune_id: ids.tuneId } },
  ])
})

it('buckets the recordings, links, and scans counted before the delete', async () => {
  const { db, analytics, ids, actions } = await setup()
  await db.recordings.bulkPut(
    Array.from({ length: 12 }, (_, i) => recordingRow(`r${i}`, { tune_id: ids.tuneId })),
  )
  await db.recordings.put(recordingRow('gone', { tune_id: ids.tuneId, deleted_at: 'then' }))
  await db.recording_links.put(linkRow('l1', ids.tuneId))
  await db.scans.put(scanRow('s1', ids.tuneId))
  await db.scans.put(scanRow('s2', ids.tuneId, { deleted_at: 'then' }))
  await actions.current.remove(ids.tuneId)
  expect(analytics.sends()).toEqual([
    {
      name: 'tune_deleted',
      props: {
        recordings_count: '10-49',
        links_count: '1-9',
        scans_count: '1-9',
        tune_id: ids.tuneId,
      },
    },
  ])
  expect((await db.tunes.get(ids.tuneId))!.deleted_at).not.toBeNull()
})

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
})

it('deletes the tune and sends nothing when a count cannot be read', async () => {
  const { db, analytics, ids, actions } = await setup()
  vi.spyOn(db.scans, 'where').mockImplementationOnce(() => {
    throw new Error('read failed')
  })
  await actions.current.remove(ids.tuneId)
  expect((await db.tunes.get(ids.tuneId))!.deleted_at).not.toBeNull()
  expect(analytics.sends()).toEqual([])
  expect(Sentry.captureException).toHaveBeenCalledOnce()
})
