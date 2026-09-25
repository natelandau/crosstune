import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { addLink, removeLink } from './links'
import { createTune } from './tunes'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('links', () => {
  it('appends links in position order with nullable metadata', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const first = await addLink(db, tuneId, {
      url: 'https://youtu.be/abc',
      provider: 'youtube',
      provider_ref: 'abc',
    })
    const second = await addLink(db, tuneId, {
      url: 'https://open.spotify.com/track/1',
      provider: 'spotify',
      title: 'Track',
      label: 'studio',
    })
    expect(await db.recording_links.get(first)).toMatchObject({
      position: 0,
      title: null,
      label: null,
    })
    expect(await db.recording_links.get(second)).toMatchObject({
      position: 1,
      title: 'Track',
      label: 'studio',
    })
    const queued = await pendingFor(db, 'recording_links', first)
    expect(queued?.data).toMatchObject({
      url: 'https://youtu.be/abc',
      provider: 'youtube',
      title: null,
    })
    expect(queued?.data).not.toHaveProperty('added_by_user_id')
  })

  it('removes with a tombstone', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const id = await addLink(db, tuneId, { url: 'https://example.com/a', provider: 'other' })
    await removeLink(db, id)
    expect((await db.recording_links.get(id))?.deleted_at).not.toBeNull()
    expect((await pendingFor(db, 'recording_links', id))?.op).toBe('delete')
  })

  it('never reissues a position freed by removal', async () => {
    const { tuneId } = await createTune(db, { title: 'X' }, { status: 'known' })
    const first = await addLink(db, tuneId, { url: 'https://example.com/a', provider: 'other' })
    const second = await addLink(db, tuneId, { url: 'https://example.com/b', provider: 'other' })
    await removeLink(db, first)
    const third = await addLink(db, tuneId, { url: 'https://example.com/c', provider: 'other' })
    expect((await db.recording_links.get(third))?.position).toBe(2)
    const activePositions = [
      (await db.recording_links.get(second))?.position,
      (await db.recording_links.get(third))?.position,
    ]
    expect(new Set(activePositions).size).toBe(activePositions.length)
  })
})
