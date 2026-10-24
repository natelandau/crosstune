import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import type { Instrument } from '../../api/vocabulary'
import { createTune, deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, testSession } from '../../test/providers'
import { useCatalog } from '../catalog/useCatalog'
import { settingsId } from '../../commands/settings'
import { useSettingsRow } from '../settings/useSettingsRow'
import { userSettingsRow } from '../../test/rows'
import { YEAR_FORMAT } from '../../ui/partialDate'
import { LEARNED_ON_INCOMPLETE, TITLE_REQUIRED } from './tuneFormValues'
import { useTuneForm, type UseTuneFormOptions } from './useTuneForm'

let db: CrosstuneDb

const playing = (instruments: Instrument[]) =>
  db.user_settings.put(userSettingsRow(settingsId(testSession.userId), { instruments }))

beforeEach(async () => {
  db = openTestDb()
  await playing(['violin'])
})

async function setup(options: Partial<UseTuneFormOptions> = {}) {
  const tuneId =
    options.tuneId ?? (await createTune(db, { title: 'Sally Goodin' }, { status: 'known' })).tuneId
  const onSaved = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(
    () => ({
      form: useTuneForm({ tuneId, onSaved, ...options }),
      catalog: useCatalog(),
    }),
    { wrapper: dataProviders({ db, analytics }) },
  )
  return { ...view, onSaved, analytics, tuneId }
}

async function ready(result: { current: { form: { ready: boolean } } }) {
  await expect.poll(() => result.current.form.ready).toBe(true)
}

describe('useTuneForm', () => {
  it('fills the time signature from a type until the player chooses one', async () => {
    const { result } = await setup()
    await ready(result)
    act(() => result.current.form.set('tune_type', 'Waltz'))
    expect(result.current.form.values.time_signature).toBe('3/4')
    act(() => result.current.form.set('time_signature', '6/8'))
    act(() => result.current.form.set('tune_type', 'Reel'))
    expect(result.current.form.values.tune_type).toBe('Reel')
    expect(result.current.form.values.time_signature).toBe('6/8')
  })

  it('keeps a field that holds a value visible for an instrument not played', async () => {
    const { tuneId } = await createTune(
      db,
      { title: 'Cripple Creek', tunings: { five_string_banjo: { tuning: 'gDGBD' } } },
      { status: 'known' },
    )
    const { result } = await setup({ tuneId })
    await ready(result)
    expect(result.current.form.visibleFields.tunings).toEqual(['violin', 'five_string_banjo'])
    expect(result.current.form.values.tunings.five_string_banjo?.tuning).toBe('gDGBD')
  })

  it('decides the visible fields once, at open', async () => {
    const { tuneId } = await createTune(db, { title: 'Sally Goodin' }, { status: 'known' })
    const view = renderHook(
      () => ({ form: useTuneForm({ tuneId, onSaved: vi.fn() }), settings: useSettingsRow() }),
      { wrapper: dataProviders({ db }) },
    )
    await expect.poll(() => view.result.current.form.ready).toBe(true)
    await playing(['violin', 'five_string_banjo'])
    await expect
      .poll(() => view.result.current.settings?.instruments)
      .toEqual(['violin', 'five_string_banjo'])
    expect(view.result.current.form.visibleFields.tunings).toEqual(['violin'])
  })

  it('disables Save until the title is valid and while a save runs', async () => {
    const { result, onSaved } = await setup()
    await ready(result)
    expect(result.current.form.canSave).toBe(true)
    act(() => result.current.form.set('title', ''))
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
    const { result, onSaved } = await setup()
    await ready(result)
    act(() => result.current.form.set('title', ''))
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
    const { result, onSaved } = await setup()
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
    const { result } = await setup()
    await ready(result)
    act(() => result.current.form.setTuning('violin', { tuning: 'AEAE' }))
    act(() => result.current.form.addPartMode())
    expect(result.current.form.touched).toMatchObject({ tunings: true, modes: true })
  })

  it('updates an edited tune and ignores a second save while one runs', async () => {
    const { tuneId } = await createTune(db, { title: 'Old' }, { status: 'known' })
    const { result, onSaved } = await setup({ tuneId })
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
    const { result, onSaved } = await setup({ tuneId })
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
    const { result } = await setup({ tuneId: 'no-such-tune' })
    await expect.poll(() => result.current.form.missing).toBe(true)
    expect(result.current.form.ready).toBe(false)
  })

  describe('analytics', () => {
    it('reports tune_edited with only the fields that changed', async () => {
      const { tuneId } = await createTune(
        db,
        { title: 'Old', key: 'D', genre: 'Old-time' },
        { status: 'known' },
      )
      const { result, onSaved, analytics } = await setup({ tuneId })
      await ready(result)
      act(() => result.current.form.set('title', 'New'))
      act(() => result.current.form.set('key', 'G'))
      act(() => void result.current.form.save())
      await expect.poll(() => onSaved.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        { name: 'tune_edited', props: { fields_changed: ['title', 'key'], tune_id: tuneId } },
      ])
    })

    it('reports a status change as tune_status_changed beside tune_edited', async () => {
      const { tuneId } = await createTune(db, { title: 'Old' }, { status: 'learning' })
      const { result, onSaved, analytics } = await setup({ tuneId })
      await ready(result)
      act(() => result.current.form.set('status', 'known'))
      act(() => void result.current.form.save())
      await expect.poll(() => onSaved.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        { name: 'tune_edited', props: { fields_changed: ['status'], tune_id: tuneId } },
        { name: 'tune_status_changed', props: { from: 'learning', to: 'known', tune_id: tuneId } },
      ])
    })

    it('reports nothing for a save that changes nothing', async () => {
      const { tuneId } = await createTune(db, { title: 'Old' }, { status: 'known' })
      const { result, onSaved, analytics } = await setup({ tuneId })
      await ready(result)
      act(() => void result.current.form.save())
      await expect.poll(() => onSaved.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([])
    })

    it('reports nothing for a refused save', async () => {
      const { result, analytics } = await setup()
      await ready(result)
      act(() => result.current.form.set('title', ''))
      act(() => void result.current.form.save())
      expect(analytics.sends()).toEqual([])
    })
  })
})
