import { renderHook } from '@testing-library/react'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tunes from '../../commands/tunes'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { recordingAnalytics } from '../../usage/testing'
import { LEARNED_ON_INCOMPLETE, TITLE_REQUIRED } from './tuneFormValues'
import { useFactWrite } from './useFactWrite'

// A passthrough the in-flight test holds once; every other test runs the real command.
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return { ...actual, updateTuneEntry: vi.fn(actual.updateTuneEntry) }
})

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(initial: string) {
  const analytics = recordingAnalytics()
  const view = renderHook(({ id }) => useFactWrite(id), {
    initialProps: { id: initial },
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...view, analytics }
}

const stored = (id: string) => db.tunes.get(id)

describe('useFactWrite', () => {
  it('writes the key and reports only key', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    const { result, analytics } = setup(tuneId)
    result.current.write({ key: 'A' })
    await expect.poll(async () => (await stored(tuneId))?.key).toBe('A')
    await expect
      .poll(() => analytics.sends())
      .toEqual([{ name: 'tune_edited', props: { fields_changed: ['key'], tune_id: tuneId } }])
  })

  it('reports a status change', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'want_to_learn' })
    const { result, analytics } = setup(tuneId)
    result.current.write({ status: 'known' })
    await expect
      .poll(() => analytics.sends().map((s) => s.name))
      .toEqual(['tune_edited', 'tune_status_changed'])
    expect(analytics.sends()[1]?.props).toEqual({
      from: 'want_to_learn',
      to: 'known',
      tune_id: tuneId,
    })
  })

  it('fills an unset time signature from the type', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    const { result } = setup(tuneId)
    result.current.write({ tune_type: 'Jig' })
    await expect.poll(async () => (await stored(tuneId))?.time_signature).toBe('6/8')
  })

  it('keeps a chosen time signature', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Reel', time_signature: '4/4' },
      { status: 'known' },
    )
    const { result } = setup(tuneId)
    result.current.write({ tune_type: 'Jig' })
    await expect.poll(async () => (await stored(tuneId))?.tune_type).toBe('Jig')
    expect((await stored(tuneId))?.time_signature).toBe('4/4')
  })

  it('trims open text the way the form does', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    const { result } = setup(tuneId)
    result.current.write({ genre: '  Old-time  ' })
    await expect.poll(async () => (await stored(tuneId))?.genre).toBe('Old-time')
  })

  it('refuses an empty title', async () => {
    const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    const { result } = setup(tuneId)
    result.current.write({ title: '   ' })
    await expect.poll(() => result.current.error).toBe(TITLE_REQUIRED)
    expect((await stored(tuneId))?.title).toBe('Reel')
  })

  it('refuses a partial learned-on date and keeps the stored one', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Reel' },
      { status: 'known', learned_on: '2024-03-05' },
    )
    const { result } = setup(tuneId)
    result.current.write({ learned_on: '2024-03' })
    await expect.poll(() => result.current.error).toBe(LEARNED_ON_INCOMPLETE)
    const userTune = await db.user_tunes.where('tune_id').equals(tuneId).first()
    expect(userTune?.learned_on).toBe('2024-03-05')
  })

  it('lands on the tune it was opened for', async () => {
    const a = await createTune(db, { title: 'A' }, { status: 'known' })
    const b = await createTune(db, { title: 'B' }, { status: 'known' })
    const { result, rerender } = setup(a.tuneId)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const actual = await vi.importActual<typeof tunes>('../../commands/tunes')
    vi.mocked(tunes.updateTuneEntry).mockImplementationOnce(async (...args) => {
      await held
      return actual.updateTuneEntry(...args)
    })
    result.current.write({ key: 'D' })
    await expect.poll(() => result.current.pending).toBe(true)
    rerender({ id: b.tuneId })
    release()
    await expect.poll(async () => (await stored(a.tuneId))?.key).toBe('D')
    await expect.poll(() => result.current.pending).toBe(false)
    expect((await stored(b.tuneId))?.key).toBeNull()
  })

  it('drops a refusal that landed before the next tune opened', async () => {
    const a = await createTune(db, { title: 'A' }, { status: 'known' })
    const b = await createTune(db, { title: 'B' }, { status: 'known' })
    const { result, rerender } = setup(a.tuneId)
    result.current.write({ title: '   ' })
    await expect.poll(() => result.current.error).toBe(TITLE_REQUIRED)
    rerender({ id: b.tuneId })
    await expect.poll(() => result.current.error).toBeNull()
  })

  it('never shows a refusal that lands after the next tune opened', async () => {
    const a = await createTune(db, { title: 'A' }, { status: 'known' })
    const b = await createTune(db, { title: 'B' }, { status: 'known' })
    const { result, rerender } = setup(a.tuneId)
    let refuse!: () => void
    const held = new Promise<void>((_, reject) => (refuse = () => reject(new Error('refused'))))
    vi.mocked(tunes.updateTuneEntry).mockImplementationOnce(() => held)
    result.current.write({ key: 'D' })
    await expect.poll(() => result.current.pending).toBe(true)
    rerender({ id: b.tuneId })
    refuse()
    await expect.poll(() => result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
    expect((await stored(a.tuneId))?.key).toBeNull()
  })

  it('keeps notes written while a fact write reads the tune', async () => {
    const { tuneId, userTuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    const actual = await vi.importActual<typeof tunes>('../../commands/tunes')
    // A keystroke in the notes field lands after the fact write has read the tune, in its own
    // transaction, as the notes field writes.
    vi.mocked(tunes.updateTuneEntry).mockImplementationOnce((...args) => {
      void Dexie.ignoreTransaction(() =>
        actual.updateUserTune(db, userTuneId, { notes: 'Typed meanwhile' }),
      )
      return actual.updateTuneEntry(...args)
    })
    const { result } = setup(tuneId)
    result.current.write({ composer: 'Kenny Baker' })
    await expect
      .poll(async () => (await db.user_tunes.get(userTuneId))?.notes)
      .toBe('Typed meanwhile')
    await expect.poll(async () => (await stored(tuneId))?.composer).toBe('Kenny Baker')
  })

  it('writes a fact on a tune whose stored learned-on date is partial', async () => {
    const { tuneId, userTuneId } = await createTune(db, { title: 'Reel' }, { status: 'known' })
    // As another client might have stored it.
    await db.user_tunes.update(userTuneId, { learned_on: '2024-03' })
    const { result } = setup(tuneId)
    result.current.write({ composer: 'Kenny Baker' })
    await expect.poll(async () => (await stored(tuneId))?.composer).toBe('Kenny Baker')
    expect(result.current.error).toBeNull()
  })
})
