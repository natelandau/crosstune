import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { createList } from '../../commands/lists'
import * as lists from '../../commands/lists'
import * as recordings from '../../commands/recordings'
import { createTune, deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { useCatalog } from '../catalog/useCatalog'
import { YEAR_FORMAT } from '../../ui/partialDate'
import { LEARNED_ON_INCOMPLETE, TITLE_REQUIRED } from './tuneFormValues'
import { useTuneForm, type UseTuneFormOptions } from './useTuneForm'

// Passthroughs the filing test overrides once; every other test runs the real commands.
vi.mock('../../commands/lists', async (original) => {
  const actual = await original<typeof lists>()
  return { ...actual, addToList: vi.fn(actual.addToList) }
})
vi.mock('../../commands/recordings', async (original) => {
  const actual = await original<typeof recordings>()
  return { ...actual, updateRecording: vi.fn(actual.updateRecording) }
})

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
})

function setup(options: Partial<UseTuneFormOptions> = {}) {
  const onSaved = vi.fn()
  const view = renderHook(
    () => ({
      form: useTuneForm({ onSaved, instruments: new Set(['violin']), ...options }),
      catalog: useCatalog(),
    }),
    { wrapper: dataProviders({ db }) },
  )
  return { ...view, onSaved }
}

async function ready(result: { current: { form: { ready: boolean } } }) {
  await expect.poll(() => result.current.form.ready).toBe(true)
}

describe('useTuneForm', () => {
  it('fills the time signature from a type until the player chooses one', async () => {
    const { result } = setup()
    await ready(result)
    act(() => result.current.form.set('tune_type', 'Waltz'))
    expect(result.current.form.values.time_signature).toBe('3/4')
    act(() => result.current.form.set('time_signature', '6/8'))
    act(() => result.current.form.set('tune_type', 'Reel'))
    expect(result.current.form.values.tune_type).toBe('Reel')
    expect(result.current.form.values.time_signature).toBe('6/8')
  })

  it('counts a pick of the time signature shown as the player choosing it', async () => {
    const { result } = setup()
    await ready(result)
    act(() => result.current.form.touch('time_signature'))
    act(() => result.current.form.set('tune_type', 'Waltz'))
    expect(result.current.form.values.time_signature).toBe('4/4')
  })

  it('keeps a field that holds a value visible for an instrument not played', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Cripple Creek', tunings: { five_string_banjo: { tuning: 'gDGBD' } } },
      { status: 'known' },
    )
    const { result } = setup({ tuneId })
    await ready(result)
    expect(result.current.form.visibleFields.tunings).toEqual(['violin', 'five_string_banjo'])
    expect(result.current.form.values.tunings.five_string_banjo?.tuning).toBe('gDGBD')
  })

  it('decides the visible fields once, at open', async () => {
    const view = renderHook(
      ({ instruments }: { instruments: ReadonlySet<Instrument> }) =>
        useTuneForm({ onSaved: vi.fn(), instruments }),
      {
        wrapper: dataProviders({ db }),
        initialProps: { instruments: new Set<Instrument>(['violin']) },
      },
    )
    await expect.poll(() => view.result.current.ready).toBe(true)
    view.rerender({ instruments: new Set(['violin', 'five_string_banjo']) })
    expect(view.result.current.visibleFields.tunings).toEqual(['violin'])
  })

  it('disables Save until the title is valid and while a save runs', async () => {
    const { result, onSaved } = setup()
    await ready(result)
    expect(result.current.form.canSave).toBe(false)
    act(() => result.current.form.set('title', '  Kesh Jig '))
    expect(result.current.form.canSave).toBe(true)
    let started: string | undefined
    act(() => {
      started = result.current.form.save()
    })
    expect(started).toBe('started')
    expect(result.current.form.pending).toBe(true)
    expect(result.current.form.canSave).toBe(false)
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.form.pending).toBe(false)
    expect(result.current.catalog?.map((e) => e.tune.title)).toContain('Kesh Jig')
  })

  it('refuses an empty title with a message that editing the title clears', async () => {
    const { result, onSaved } = setup()
    await ready(result)
    let started: string | undefined
    act(() => {
      started = result.current.form.save()
    })
    expect(started).toBe('invalid')
    expect(result.current.form.errors).toEqual({ title: TITLE_REQUIRED })
    act(() => result.current.form.set('title', 'A'))
    expect(result.current.form.errors).toEqual({})
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('refuses a learned-on date until it is whole, on a save or once it is left', async () => {
    const { result, onSaved } = setup({ initialTitle: 'Sally Goodin' })
    await ready(result)
    act(() => result.current.form.set('learned_on', '19'))
    expect(result.current.form.canSave).toBe(false)
    let started: string | undefined
    act(() => {
      started = result.current.form.save()
    })
    expect(started).toBe('invalid')
    expect(result.current.form.errors).toEqual({ learned_on: YEAR_FORMAT })
    act(() => result.current.form.set('learned_on', '1999'))
    expect(result.current.form.errors).toEqual({})
    expect(result.current.form.canSave).toBe(false)
    act(() => result.current.form.validate('learned_on'))
    expect(result.current.form.errors).toEqual({ learned_on: LEARNED_ON_INCOMPLETE })
    act(() => result.current.form.set('learned_on', '1999-3-14'))
    act(() => result.current.form.validate('learned_on'))
    expect(result.current.form.errors).toEqual({})
    expect(result.current.form.canSave).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('counts a tuning or a part mode as typed work', async () => {
    const { result } = setup()
    await ready(result)
    act(() => result.current.form.setTuning('violin', { tuning: 'AEAE' }))
    act(() => result.current.form.addPartMode())
    expect(result.current.form.touched).toMatchObject({ tunings: true, modes: true })
  })

  it('starts a new tune with the initial title, capped, and seeds the most used genre', async () => {
    await createTune(db, { title: 'One', genre: 'Irish' }, { status: 'known' })
    const { result } = setup({ initialTitle: 'x'.repeat(500) })
    await ready(result)
    expect(result.current.form.values.title).toHaveLength(TUNE_LIMITS.title)
    await expect.poll(() => result.current.form.values.genre).toBe('Irish')
    expect(result.current.form.suggestions.types.length).toBeGreaterThan(0)
  })

  it('stands the seeded genre down once the player picks one', async () => {
    await createTune(db, { title: 'One', genre: 'Irish' }, { status: 'known' })
    const { result } = setup()
    await ready(result)
    await expect.poll(() => result.current.form.values.genre).toBe('Irish')
    act(() => result.current.form.set('genre', ''))
    await expect.poll(() => result.current.catalog?.length).toBe(1)
    expect(result.current.form.values.genre).toBe('')
  })

  it('files a new tune on a list and a recording', async () => {
    const listId = await createList(db, 'Session')
    const recordingId = await captureRecording(db)
    const { result, onSaved } = setup({ listId, recordingId })
    await ready(result)
    act(() => result.current.form.set('title', 'Banshee'))
    act(() => void result.current.form.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    const [tuneId, { filingError }] = onSaved.mock.calls[0]!
    expect(filingError).toBeUndefined()
    expect((await db.recordings.get(recordingId))?.tune_id).toBe(tuneId)
    expect(await db.list_items.where('list_id').equals(listId).count()).toBe(1)
  })

  it('updates an edited tune and ignores a second save while one runs', async () => {
    const { tuneId } = await createTune(db, { title: 'Old' }, { status: 'known' })
    const { result, onSaved } = setup({ tuneId })
    await ready(result)
    expect(result.current.form.values.title).toBe('Old')
    act(() => result.current.form.set('title', 'New'))
    let second: string | undefined
    act(() => {
      result.current.form.save()
      second = result.current.form.save()
    })
    expect(second).toBe('ignored')
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    expect((await db.tunes.get(tuneId))?.title).toBe('New')
    expect(await db.tunes.count()).toBe(1)
  })

  it('never creates a tune from an edit of one deleted after the form opened', async () => {
    const { tuneId } = await createTune(db, { title: 'Gone' }, { status: 'known' })
    const { result, onSaved } = setup({ tuneId })
    await ready(result)
    expect(result.current.form.missing).toBe(false)
    await deleteTune(db, tuneId)
    await expect.poll(() => result.current.form.missing).toBe(true)
    expect(result.current.form.canSave).toBe(false)
    let started: string | undefined
    act(() => {
      started = result.current.form.save()
    })
    expect(started).toBe('ignored')
    expect(onSaved).not.toHaveBeenCalled()
    expect(await db.tunes.filter((t) => !t.deleted_at).count()).toBe(0)
  })

  it('reports a tune that is not in the catalog as missing', async () => {
    const { result } = setup({ tuneId: 'no-such-tune' })
    await expect.poll(() => result.current.form.missing).toBe(true)
    expect(result.current.form.ready).toBe(false)
  })

  it('keeps a saved tune when the list and the recording both refuse it', async () => {
    vi.mocked(lists.addToList).mockRejectedValueOnce(new Error('List is gone'))
    vi.mocked(recordings.updateRecording).mockRejectedValueOnce(new Error('Recording is gone'))
    const { result, onSaved } = setup({ listId: 'l', recordingId: 'r' })
    await ready(result)
    act(() => result.current.form.set('title', 'Banshee'))
    act(() => void result.current.form.save())
    await expect.poll(() => onSaved.mock.calls.length).toBe(1)
    expect(onSaved.mock.calls[0]![1].filingError).toBe('List is gone')
    // The recording is still tried after the list refuses.
    expect(recordings.updateRecording).toHaveBeenCalledOnce()
    expect(lists.addToList).toHaveBeenCalledOnce()
    await expect.poll(() => result.current.form.pending).toBe(false)
    expect(result.current.form.canSave).toBe(false)
    let again: string | undefined
    act(() => {
      again = result.current.form.save()
    })
    expect(again).toBe('ignored')
    expect(await db.tunes.count()).toBe(1)
  })
})
