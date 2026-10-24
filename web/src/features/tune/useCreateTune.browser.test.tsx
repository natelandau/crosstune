import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { createList } from '../../commands/lists'
import * as lists from '../../commands/lists'
import { setNewTuneGenre, setNewTuneStatus } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, testSession } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { TUNE_LIMITS } from '../../api/vocabulary'
import { useCreateTune } from './useCreateTune'

vi.mock('../../commands/lists', async (original) => {
  const actual = await original<typeof lists>()
  return { ...actual, addToList: vi.fn(actual.addToList) }
})

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup() {
  const analytics = recordingAnalytics()
  const view = renderHook(() => useCreateTune(), { wrapper: dataProviders({ db, analytics }) })
  return { ...view, analytics }
}

describe('useCreateTune', () => {
  it('creates with the New tunes defaults', async () => {
    await setNewTuneStatus(db, testSession.userId, 'learning')
    await setNewTuneGenre(db, testSession.userId, ' Irish ')
    const { result } = setup()
    const { tuneId, userTuneId } = await result.current({
      title: ' Banshee ',
      source: 'search_offer',
    })
    const tune = await db.tunes.get(tuneId)
    const userTune = await db.user_tunes.get(userTuneId)
    expect(tune).toMatchObject({
      title: 'Banshee',
      genre: 'Irish',
      key: null,
      tune_type: null,
      composer: null,
      modes: [],
      alternate_titles: [],
    })
    expect(userTune).toMatchObject({ status: 'learning', learned_from: null, notes: null })
  })

  it('starts as want to learn with no genre when nothing is set', async () => {
    const { result } = setup()
    const { tuneId, userTuneId } = await result.current({
      title: 'Banshee',
      source: 'search_offer',
    })
    expect((await db.tunes.get(tuneId))?.genre).toBeNull()
    expect((await db.user_tunes.get(userTuneId))?.status).toBe('want_to_learn')
  })

  it('reports the create', async () => {
    await setNewTuneStatus(db, testSession.userId, 'learning')
    await setNewTuneGenre(db, testSession.userId, 'Irish')
    const { result, analytics } = setup()
    const { tuneId } = await result.current({ title: 'Banshee', source: 'search_offer' })
    const sent = analytics.sends().filter((s) => s.name === 'tune_created')
    expect(sent).toHaveLength(1)
    const props = sent[0]!.props as { source: string; tune_id: string; fields_set: string[] }
    expect(props.source).toBe('search_offer')
    expect(props.tune_id).toBe(tuneId)
    expect(props.fields_set).toEqual(['title', 'status', 'genre'])
  })

  it('reports only the title for a tune created with nothing else set', async () => {
    const { result, analytics } = setup()
    await result.current({ title: 'Banshee', source: 'search_offer' })
    const [sent] = analytics.sends().filter((s) => s.name === 'tune_created')
    expect((sent!.props as { fields_set: string[] }).fields_set).toEqual(['title'])
  })

  it('files a recording under the new tune', async () => {
    const recordingId = await captureRecording(db)
    const { result } = setup()
    const created = await result.current({ title: 'Banshee', source: 'search_offer', recordingId })
    expect(created.filingError).toBeUndefined()
    expect((await db.recordings.get(recordingId))?.tune_id).toBe(created.tuneId)
  })

  it('adds the new tune to a list', async () => {
    const listId = await createList(db, 'Session')
    const { result } = setup()
    const created = await result.current({ title: 'Banshee', source: 'search_offer', listId })
    expect(created.filingError).toBeUndefined()
    const items = await db.list_items.where('list_id').equals(listId).toArray()
    expect(items).toHaveLength(1)
    expect(items[0]!.user_tune_id).toBe(created.userTuneId)
  })

  it('a refused filing still creates the tune and returns its error', async () => {
    vi.mocked(lists.addToList).mockRejectedValueOnce(new Error('List is gone'))
    const { result } = setup()
    const created = await result.current({ title: 'Banshee', source: 'search_offer', listId: 'l' })
    expect(created.filingError).toBe('List is gone')
    expect(await db.tunes.get(created.tuneId)).toBeDefined()
  })

  it('refuses a blank title', async () => {
    const { result } = setup()
    await expect(result.current({ title: '   ', source: 'search_offer' })).rejects.toThrow()
    expect(await db.tunes.count()).toBe(0)
    expect(await db.user_tunes.count()).toBe(0)
  })

  it('keeps a title at its limit after the spaces it was typed with', async () => {
    const { result } = setup()
    const title = 'a'.repeat(TUNE_LIMITS.title)
    const created = await result.current({ title: `   ${title} `, source: 'search_offer' })
    expect((await db.tunes.get(created.tuneId))?.title).toBe(title)
    expect(created.title).toBe(title)
  })

  it('files a recording it could not read for the report, and reports no filing', async () => {
    const recordingId = await captureRecording(db)
    vi.spyOn(db.recordings, 'get').mockRejectedValueOnce(new Error('Read failed'))
    const { result, analytics } = setup()
    const created = await result.current({ title: 'Banshee', source: 'search_offer', recordingId })
    expect(created.filingError).toBeUndefined()
    expect((await db.recordings.get(recordingId))?.tune_id).toBe(created.tuneId)
    expect(analytics.sends().map((sent) => sent.name)).not.toContain('recording_filed')
  })
})
