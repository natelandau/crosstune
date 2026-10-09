import { act, renderHook } from '@testing-library/react'
import { recordingAnalytics } from '../../usage/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { NO_DATE, YEAR_FORMAT } from '../../ui/partialDate'
import { recordedTime } from '../../text/format'
import { recordedAtNote } from './recordingCopy'
import { useEditRecording } from './useEditRecording'
import type { RecordingView } from './useRecordings'

let db: CrosstuneDb

const viewOf = (extra: Parameters<typeof recordingRow>[1] = {}): RecordingView => ({
  recording: recordingRow('r1', { label: 'Jam recording', ...extra }),
  file: undefined,
  tuneId: null,
  tuneTitle: null,
})

beforeEach(() => {
  db = openTestDb()
})

function setup(view: RecordingView | null, onDateError = vi.fn()) {
  const onClose = vi.fn()
  const analytics = recordingAnalytics()
  const hook = renderHook(
    ({ target }: { target: RecordingView | null }) =>
      useEditRecording(target, { onClose, onDateError }),
    { wrapper: dataProviders({ db, analytics }), initialProps: { target: view } },
  )
  return { ...hook, onClose, onDateError, analytics }
}

describe('useEditRecording', () => {
  it('opens on the stored name and date, clean', () => {
    const { result } = setup(
      viewOf({ recorded_at: '2024-03-05T00:00:00.000Z', recorded_precision: 'day' }),
    )
    expect(result.current.open).toBe(true)
    expect(result.current.name).toBe('Jam recording')
    expect(result.current.parts).toEqual({ year: '2024', month: '3', day: '5' })
    expect(result.current.dirty).toBe(false)
  })

  it('takes no day without a month', () => {
    const { result } = setup(viewOf({ recorded_at: null, recorded_precision: null }))
    act(() => result.current.editParts({ year: '2024' }))
    expect(result.current.monthEnabled).toBe(true)
    expect(result.current.dayEnabled).toBe(false)
    act(() => result.current.editParts({ day: '5' }))
    expect(result.current.parts).toEqual({ year: '2024', month: '', day: '' })
    act(() => result.current.editParts({ month: '3', day: '5' }))
    expect(result.current.dayEnabled).toBe(true)
    act(() => result.current.editParts({ month: '' }))
    expect(result.current.parts).toEqual({ year: '2024', month: '', day: '' })
  })

  it('shows the take’s exact time only while the date is left alone', () => {
    const { result } = setup(viewOf())
    const at = recordingRow('r1').recorded_at!
    expect(result.current.timeNote).toBe(recordedAtNote(recordedTime(at)))
    act(() => result.current.editParts({ month: '' }))
    expect(result.current.timeNote).toBeNull()
    expect(result.current.dirty).toBe(true)
  })

  it('refuses a short year, saving nothing', async () => {
    await db.recordings.put(viewOf().recording)
    const { result, onDateError } = setup(viewOf({ recorded_at: null, recorded_precision: null }))
    act(() => result.current.editParts({ year: '24' }))
    act(() => result.current.save())
    expect(result.current.dateError).toBe(YEAR_FORMAT)
    expect(onDateError).toHaveBeenCalledOnce()
    expect(result.current.closing).toBe(false)
    act(() => result.current.editParts({ year: '2024' }))
    expect(result.current.dateError).toBeNull()
  })

  it('saves the name and date, then closes', async () => {
    await db.recordings.put(viewOf().recording)
    const { result } = setup(viewOf())
    act(() => result.current.setName('  Session at Tom’s  '))
    act(() => result.current.clearDate())
    expect(result.current.parts).toEqual(NO_DATE)
    expect(result.current.canClearDate).toBe(false)
    act(() => result.current.save())
    await expect.poll(() => result.current.closing).toBe(true)
    const row = await db.recordings.get('r1')
    expect(row?.label).toBe('Session at Tom’s')
    expect(row?.recorded_at).toBeNull()
  })

  describe('analytics', () => {
    it('sends recording_renamed with the origin when the label changed', async () => {
      await db.recordings.put(viewOf().recording)
      const { result, analytics } = setup(viewOf())
      act(() => result.current.setName('Session at Tom’s'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)

      expect(analytics.sends()).toEqual([
        { name: 'recording_renamed', props: { origin: 'recorded', recording_id: 'r1' } },
      ])
    })

    it('sends nothing when only the date changed', async () => {
      await db.recordings.put(viewOf().recording)
      const { result, analytics } = setup(viewOf())
      act(() => result.current.clearDate())
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)

      expect(analytics.sends()).toEqual([])
    })

    it('sends nothing when the name was cleared on an unnamed recording', async () => {
      await db.recordings.put(viewOf({ label: null }).recording)
      const { result, analytics } = setup(viewOf({ label: null }))
      act(() => result.current.setName('   '))
      act(() => result.current.editParts({ day: '' }))
      act(() => result.current.clearDate())
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)

      expect(analytics.sends()).toEqual([])
    })
  })
})
