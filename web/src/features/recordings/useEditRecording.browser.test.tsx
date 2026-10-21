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
import type { PlaceChoice } from './place'
import { useEditRecording } from './useEditRecording'
import type { RecordingView } from './useRecordings'

let db: CrosstuneDb

const GALAX: PlaceChoice = { name: 'Galax, VA', lat: 36.6612345, lon: -80.9234567 }
const AIRY: PlaceChoice = { name: 'Mount Airy, NC', lat: 36.5, lon: -80.6 }
const atGalax = {
  place_name: GALAX.name,
  place_lat: GALAX.lat,
  place_lon: GALAX.lon,
  place_accuracy_m: 15,
}

const unnamedCoords = { place_lat: GALAX.lat, place_lon: GALAX.lon, place_accuracy_m: 15 }

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

    async function savePlace(
      extra: Parameters<typeof recordingRow>[1],
      change: (edit: ReturnType<typeof setup>['result']['current']) => void,
    ) {
      await db.recordings.put(viewOf(extra).recording)
      const { result, analytics } = setup(viewOf(extra))
      act(() => change(result.current))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      return analytics.sends()
    }

    it('sends recording_place_set when a place is picked on a recording without one', async () => {
      const sends = await savePlace({}, (edit) => edit.setPlace(GALAX, 'search'))
      expect(sends).toEqual([
        {
          name: 'recording_place_set',
          props: { method: 'search', recording_id: 'r1', replaced: false },
        },
      ])
    })

    it('sends replaced when the recording had a place', async () => {
      const sends = await savePlace(atGalax, (edit) => edit.setPlace(AIRY, 'suggestion'))
      expect(sends).toEqual([
        {
          name: 'recording_place_set',
          props: { method: 'suggestion', recording_id: 'r1', replaced: true },
        },
      ])
    })

    it('sends recording_place_cleared when the place is cleared', async () => {
      const sends = await savePlace(atGalax, (edit) => edit.setPlace(null, null))
      expect(sends).toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
    })

    it('sends recording_place_cleared when unnamed coordinates are cleared', async () => {
      const sends = await savePlace(unnamedCoords, (edit) => edit.setPlace(null, null))
      expect(sends).toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
    })

    it('sends no place event when the place is left alone or picked again', async () => {
      expect(await savePlace(atGalax, (edit) => edit.setNotes('Fast'))).toEqual([])
      expect(await savePlace(atGalax, (edit) => edit.setPlace(GALAX, 'suggestion'))).toEqual([])
    })

    it('never sends any part of the place', async () => {
      const sends = await savePlace({}, (edit) => edit.setPlace(GALAX, 'search'))
      const text = JSON.stringify(sends)
      for (const part of [GALAX.name, 'Galax', String(GALAX.lat), String(GALAX.lon)]) {
        expect(text).not.toContain(part)
      }
    })
  })

  describe('notes, players, and place', () => {
    it('opens on the stored values, clean', () => {
      const { result } = setup(viewOf({ notes: 'Capo 2', players: 'Kevin', ...atGalax }))
      expect(result.current.notes).toBe('Capo 2')
      expect(result.current.players).toBe('Kevin')
      expect(result.current.place).toEqual(GALAX)
      expect(result.current.dirty).toBe(false)
    })

    it.each([
      ['notes', (edit: ReturnType<typeof setup>['result']['current']) => edit.setNotes('Slow')],
      ['players', (edit: ReturnType<typeof setup>['result']['current']) => edit.setPlayers('Ru')],
      [
        'place',
        (edit: ReturnType<typeof setup>['result']['current']) => edit.setPlace(GALAX, 'search'),
      ],
    ])('is dirty after a %s change', (_, change) => {
      const { result } = setup(viewOf())
      act(() => change(result.current))
      expect(result.current.dirty).toBe(true)
    })

    it('saves notes, players, and a picked place, clearing the accuracy', async () => {
      await db.recordings.put(viewOf({ ...atGalax }).recording)
      const { result } = setup(viewOf({ ...atGalax }))
      act(() => result.current.setNotes('  Capo 2\nTuned low  '))
      act(() => result.current.setPlayers('  Kevin and Ruth '))
      act(() => result.current.setPlace(AIRY, 'search'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect(row.notes).toBe('Capo 2\nTuned low')
      expect(row.players).toBe('Kevin and Ruth')
      expect([row.place_name, row.place_lat, row.place_lon, row.place_accuracy_m]).toEqual([
        AIRY.name,
        AIRY.lat,
        AIRY.lon,
        null,
      ])
    })

    it('saves blank notes and players as none, and a cleared place clears all four', async () => {
      const extra = { notes: 'Capo 2', players: 'Kevin', ...atGalax }
      await db.recordings.put(viewOf(extra).recording)
      const { result } = setup(viewOf(extra))
      act(() => result.current.setNotes('  '))
      act(() => result.current.setPlayers(''))
      act(() => result.current.setPlace(null, null))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect([row.notes, row.players]).toEqual([null, null])
      expect([row.place_name, row.place_lat, row.place_lon, row.place_accuracy_m]).toEqual([
        null,
        null,
        null,
        null,
      ])
    })

    it('can clear a place only when there is one, named or not', () => {
      expect(setup(viewOf()).result.current.canClearPlace).toBe(false)
      expect(setup(viewOf(atGalax)).result.current.canClearPlace).toBe(true)
      const { result } = setup(viewOf(unnamedCoords))
      expect(result.current.place).toBeNull()
      expect(result.current.canClearPlace).toBe(true)
      expect(result.current.dirty).toBe(false)
      act(() => result.current.setPlace(null, null))
      expect(result.current.canClearPlace).toBe(false)
      expect(result.current.dirty).toBe(true)
    })

    it('clears unnamed coordinates, all four', async () => {
      await db.recordings.put(viewOf(unnamedCoords).recording)
      const { result } = setup(viewOf(unnamedCoords))
      act(() => result.current.setPlace(null, null))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect([row.place_name, row.place_lat, row.place_lon, row.place_accuracy_m]).toEqual([
        null,
        null,
        null,
        null,
      ])
    })

    it('keeps unnamed coordinates it was not asked to clear', async () => {
      await db.recordings.put(viewOf(unnamedCoords).recording)
      const { result } = setup(viewOf(unnamedCoords))
      act(() => result.current.setNotes('Slow'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect([row.place_lat, row.place_lon, row.place_accuracy_m]).toEqual([
        GALAX.lat,
        GALAX.lon,
        15,
      ])
    })

    it('shows a name that arrives for its unnamed coordinates, still clean', async () => {
      await db.recordings.put(viewOf(unnamedCoords).recording)
      const { result } = setup(viewOf(unnamedCoords))
      await db.recordings.update('r1', { place_name: GALAX.name })
      await expect.poll(() => result.current.place).toEqual(GALAX)
      expect(result.current.dirty).toBe(false)
      expect(result.current.canClearPlace).toBe(true)
      act(() => result.current.setNotes('Slow'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect([row.place_name, row.place_accuracy_m]).toEqual([GALAX.name, 15])
    })

    it('leaves a cleared place cleared when its name arrives', async () => {
      await db.recordings.put(viewOf(unnamedCoords).recording)
      const { result } = setup(viewOf(unnamedCoords))
      act(() => result.current.setPlace(null, null))
      await db.recordings.update('r1', { place_name: GALAX.name })
      // The arrival shows among the recent places once the sheet has read it.
      await expect.poll(() => result.current.recentPlaces).toEqual([GALAX])
      expect(result.current.place).toBeNull()
      expect(result.current.dirty).toBe(true)
    })

    it('keeps a place it was not asked to change, accuracy included', async () => {
      await db.recordings.put(viewOf(atGalax).recording)
      const { result } = setup(viewOf(atGalax))
      act(() => result.current.setNotes('Slow'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect(row.notes).toBe('Slow')
      expect(row.place_accuracy_m).toBe(15)
    })

    it('keeps notes and players it did not edit, so a synced edit survives', async () => {
      const opened = viewOf({ notes: 'Old notes', players: 'Kevin' })
      await db.recordings.put(opened.recording)
      const { result } = setup(opened)
      await db.recordings.update('r1', { notes: 'Synced notes', players: 'Ruth' })
      act(() => result.current.setName('Jam'))
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      const row = (await db.recordings.get('r1'))!
      expect([row.label, row.notes, row.players]).toEqual(['Jam', 'Synced notes', 'Ruth'])
    })

    it('suggests players and the places on recordings, its own included', async () => {
      await db.recordings.bulkPut([
        viewOf(atGalax).recording,
        recordingRow('r2', {
          added_at: '2026-02-01T12:00:00.000Z',
          players: 'Ruth',
          place_name: AIRY.name,
          place_lat: AIRY.lat,
          place_lon: AIRY.lon,
        }),
        recordingRow('r3', { players: 'kevin' }),
      ])
      const { result } = setup(viewOf({ ...atGalax, players: 'Kevin' }))
      await expect.poll(() => result.current.playerSuggestions).toEqual(['kevin', 'Ruth'])
      await expect.poll(() => result.current.recentPlaces).toEqual([AIRY, GALAX])
    })
  })
})
