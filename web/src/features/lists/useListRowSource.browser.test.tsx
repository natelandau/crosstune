import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { PLAY_FIRST, type PlayFirst } from '../../api/vocabulary'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalUserTune } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { linkRow, recordingFile, recordingRow } from '../../test/rows'
import { useListRowSources } from './useListRowSource'
import { useListView } from './useLists'

let db: CrosstuneDb
let listId: string
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  const { userTuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
  await addToList(db, listId, userTuneId)
})

async function setup(playFirst: PlayFirst | undefined, pin: Partial<LocalUserTune> = {}) {
  const wrapper = dataProviders({ db })
  const list = renderHook(() => useListView(listId), { wrapper })
  await expect.poll(() => list.result.current?.items.length).toBe(1)
  const view = list.result.current!.items[0]!
  const entry = { ...view, userTune: { ...view.userTune, ...pin } }
  tuneId = entry.tune.id
  const sources = renderHook(() => useListRowSources([entry], playFirst), { wrapper })
  return {
    result: {
      get current() {
        return sources.result.current?.get(entry.item.id)
      },
    },
  }
}

async function addMedia() {
  await db.recordings.put(recordingRow('rec1', { tune_id: tuneId }))
  await db.recording_files.put(recordingFile('rec1'))
  await db.recording_links.put(linkRow('link1', tuneId, { provider: 'apple_music' }))
}

describe('useListRowSources', () => {
  it('stays unread until the play-first setting is known', async () => {
    const { result } = await setup(undefined)
    await expect.poll(() => result.current).toBeUndefined()
  })

  it('has nothing to play for a tune with no media', async () => {
    const { result } = await setup(PLAY_FIRST[0])
    await expect.poll(() => result.current).toBeNull()
  })

  const idOf = (source: Awaited<ReturnType<typeof setup>>['result']['current']) =>
    source ? (source.kind === 'recording' ? source.view.recording.id : source.link.id) : null

  describe('with a recording and an Apple Music link', () => {
    it('plays the recording first by default', async () => {
      const { result } = await setup(PLAY_FIRST[0])
      await addMedia()
      await expect.poll(() => idOf(result.current)).toBe('rec1')
      expect(result.current).toMatchObject({ kind: 'recording' })
    })

    it('plays the link when the user prefers Apple Music', async () => {
      const { result } = await setup('apple_music')
      await addMedia()
      await expect.poll(() => idOf(result.current)).toBe('link1')
      expect(result.current).toMatchObject({ kind: 'link' })
    })

    it('plays the pinned link over the play-first choice', async () => {
      const { result } = await setup(PLAY_FIRST[0], { play_link_id: 'link1' })
      await addMedia()
      await expect.poll(() => idOf(result.current)).toBe('link1')
    })
  })
})

describe('useListRowSources across rows', () => {
  it("gives each row its own tune's source", async () => {
    const { userTuneId } = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    await addToList(db, listId, userTuneId)
    const wrapper = dataProviders({ db })
    const list = renderHook(() => useListView(listId), { wrapper })
    await expect.poll(() => list.result.current?.items.length).toBe(2)
    const [first, second] = list.result.current!.items
    await db.recordings.put(recordingRow('rec1', { tune_id: first!.tune.id }))
    await db.recording_links.put(linkRow('link2', second!.tune.id))

    const { result } = renderHook(() => useListRowSources([first!, second!], PLAY_FIRST[0]), {
      wrapper,
    })

    await expect
      .poll(() => result.current?.get(first!.item.id))
      .toMatchObject({ kind: 'recording' })
    expect(result.current?.get(second!.item.id)).toMatchObject({
      kind: 'link',
      link: { id: 'link2' },
    })
  })
})
