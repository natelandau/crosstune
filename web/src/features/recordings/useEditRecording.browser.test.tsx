import { act, renderHook } from '@testing-library/react'
import { recordingAnalytics } from '../../usage/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { placeRow, recordingRow } from '../../test/rows'
import { deleteSavedPlace, renameSavedPlace } from '../../commands/places'
import { NO_DATE, YEAR_FORMAT } from '../../ui/partialDate'
import { recordedTime } from '../../text/format'
import { recordedAtNote } from './recordingCopy'
import type { PlaceResult } from '../../api/types'
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

/** A town as search answers it, which saves no location. */
const townResult = (choice: PlaceChoice): PlaceResult => ({
  ...choice,
  title: choice.name,
  subtitle: null,
  kind: 'town',
})

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

  it('shows the recording’s exact time only while the date is left alone', () => {
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
      const sends = await savePlace({}, (edit) => edit.pickSearch(townResult(GALAX)))
      expect(sends).toEqual([
        {
          name: 'recording_place_set',
          props: { method: 'search', recording_id: 'r1', replaced: false },
        },
      ])
    })

    it('sends replaced when the recording had a place', async () => {
      const sends = await savePlace(atGalax, (edit) => edit.pickRecent(AIRY))
      expect(sends).toEqual([
        {
          name: 'recording_place_set',
          props: { method: 'suggestion', recording_id: 'r1', replaced: true },
        },
      ])
    })

    it('sends recording_place_cleared when the place is cleared', async () => {
      const sends = await savePlace(atGalax, (edit) => edit.clearPlace())
      expect(sends).toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
    })

    it('sends recording_place_cleared when unnamed coordinates are cleared', async () => {
      const sends = await savePlace(unnamedCoords, (edit) => edit.clearPlace())
      expect(sends).toEqual([{ name: 'recording_place_cleared', props: { recording_id: 'r1' } }])
    })

    it('sends no place event when the place is left alone or picked again', async () => {
      expect(await savePlace(atGalax, (edit) => edit.setNotes('Fast'))).toEqual([])
      expect(await savePlace(atGalax, (edit) => edit.pickRecent(GALAX))).toEqual([])
    })

    it('never sends any part of the place', async () => {
      const sends = await savePlace({}, (edit) => edit.pickSearch(townResult(GALAX)))
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
        (edit: ReturnType<typeof setup>['result']['current']) => edit.pickSearch(townResult(GALAX)),
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
      act(() => result.current.pickSearch(townResult(AIRY)))
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
      act(() => result.current.clearPlace())
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
      act(() => result.current.clearPlace())
      expect(result.current.canClearPlace).toBe(false)
      expect(result.current.dirty).toBe(true)
    })

    it('clears unnamed coordinates, all four', async () => {
      await db.recordings.put(viewOf(unnamedCoords).recording)
      const { result } = setup(viewOf(unnamedCoords))
      act(() => result.current.clearPlace())
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
      act(() => result.current.clearPlace())
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

  describe('saved locations', () => {
    const street = '200 Eastern Pkwy, Brooklyn, NY'
    const spot = { lat: 40.6718, lon: -73.9635, accuracyM: 12 }
    const captured = (extra: Parameters<typeof recordingRow>[1] = {}) =>
      viewOf({
        place_name: street,
        place_lat: spot.lat,
        place_lon: spot.lon,
        place_accuracy_m: spot.accuracyM,
        place_origin: 'device',
        ...extra,
      })
    const jalopy = {
      name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
      lat: 40.6845,
      lon: -74.0019,
    }
    const jalopyResult: PlaceResult = {
      ...jalopy,
      title: 'Jalopy Theatre',
      subtitle: '315 Columbia St, Brooklyn, NY',
      kind: 'venue',
      address: '315 Columbia St, Brooklyn, NY',
    }
    const rex = {
      name: 'Rex Theater',
      address: '113 E Grayson St, Galax, VA',
      lat: 36.6603,
      lon: -80.9201,
      applePlaceId: 'I1234',
    }

    async function open(view: RecordingView, places: ReturnType<typeof placeRow>[] = []) {
      await db.recordings.put(view.recording)
      if (places.length) await db.places.bulkPut(places)
      const hook = setup(view)
      if (places.length)
        await expect.poll(() => hook.result.current.savedPlaces.length).toBe(places.length)
      return hook
    }

    async function save(result: ReturnType<typeof setup>['result']) {
      act(() => result.current.save())
      await expect.poll(() => result.current.closing).toBe(true)
      return (await db.recordings.get('r1'))!
    }

    it('naming creates a saved place at the recording and links it, on Save', async () => {
      const { result, analytics } = await open(captured())
      expect(result.current.canNamePlace).toBe(true)
      act(() => result.current.nameLocation('  Tom’s kitchen  '))
      expect(result.current.place?.name).toBe('Tom’s kitchen')
      expect(result.current.placeAddress).toBe(street)
      expect(result.current.dirty).toBe(true)
      expect(await db.places.count()).toBe(0)

      const row = await save(result)
      const [place] = await db.places.toArray()
      expect(place).toMatchObject({
        name: 'Tom’s kitchen',
        address: street,
        lat: spot.lat,
        lon: spot.lon,
      })
      expect(row).toMatchObject({
        place_id: place!.id,
        place_origin: 'picked',
        place_name: street,
        place_accuracy_m: 12,
      })
      expect(
        analytics
          .sends()
          .map((e) => e.name)
          .sort(),
      ).toEqual(['recording_place_set', 'saved_location_created'])
      expect(analytics.sends()).toContainEqual({
        name: 'saved_location_created',
        props: { method: 'custom' },
      })
      expect(analytics.sends()).toContainEqual({
        name: 'recording_place_set',
        props: { method: 'saved', recording_id: 'r1', replaced: true },
      })
    })

    it('naming on a linked recording relinks only that recording', async () => {
      const barn = placeRow('p1', 'The barn', { lat: spot.lat, lon: spot.lon })
      await db.recordings.put(captured({ place_id: 'p1' }).recording)
      await db.recordings.put({ ...captured({ place_id: 'p1' }).recording, id: 'r2' })
      const { result } = await open(captured({ place_id: 'p1' }), [barn])
      await expect.poll(() => result.current.place?.name).toBe('The barn')
      act(() => result.current.nameLocation('Upstairs flat'))
      const row = await save(result)
      const flat = (await db.places.toArray()).find((p) => p.name === 'Upstairs flat')!
      expect((await db.places.get('p1'))?.name).toBe('The barn')
      expect(row.place_id).toBe(flat.id)
      expect((await db.recordings.get('r2'))?.place_id).toBe('p1')
    })

    it('Name this location is offered only for a precise point', async () => {
      expect((await open(captured({ place_accuracy_m: 120 }))).result.current.canNamePlace).toBe(
        false,
      )
      expect(setup(viewOf()).result.current.canNamePlace).toBe(false)
      expect(
        setup(captured({ place_accuracy_m: null, place_origin: 'file' })).result.current
          .canNamePlace,
      ).toBe(true)
    })

    it('picking a nearby venue saves it at its own point and the recording keeps its own', async () => {
      const { result, analytics } = await open(captured())
      act(() => result.current.pickNearby({ kind: 'venue', venue: rex }))
      expect(result.current.place?.name).toBe('Rex Theater')
      expect(result.current.placeAddress).toBe(rex.address)
      const row = await save(result)
      const [place] = await db.places.toArray()
      expect(place).toMatchObject({
        name: 'Rex Theater',
        address: rex.address,
        lat: rex.lat,
        lon: rex.lon,
        apple_place_id: 'I1234',
      })
      expect(row).toMatchObject({
        place_id: place!.id,
        place_lat: spot.lat,
        place_lon: spot.lon,
        place_accuracy_m: 12,
        place_name: street,
      })
      expect(analytics.sends()).toContainEqual({
        name: 'saved_location_created',
        props: { method: 'nearby' },
      })
      expect(analytics.sends()).toContainEqual({
        name: 'recording_place_set',
        props: { method: 'nearby', recording_id: 'r1', replaced: true },
      })
    })

    it('picking a searched venue saves it and moves the recording', async () => {
      const { result, analytics } = await open(captured())
      act(() => result.current.pickSearch(jalopyResult))
      const row = await save(result)
      const [place] = await db.places.toArray()
      expect(place).toMatchObject({ name: 'Jalopy Theatre', address: jalopyResult.address })
      expect(row).toMatchObject({
        place_id: place!.id,
        place_name: jalopy.name,
        place_lat: jalopy.lat,
        place_lon: jalopy.lon,
        place_accuracy_m: null,
      })
      expect(analytics.sends()).toContainEqual({
        name: 'saved_location_created',
        props: { method: 'search' },
      })
    })

    it('picking a searched street address saves it under its own name', async () => {
      const { result } = await open(captured())
      const center: PlaceResult = {
        name: '1038 Center St, Newton, MA',
        lat: 42.33,
        lon: -71.2,
        title: '1038 Center St',
        subtitle: 'Newton, MA',
        kind: 'address',
      }
      act(() => result.current.pickSearch(center))
      act(() => result.current.nameLocation('Grandma’s'))
      expect(result.current.placeAddress).toBe(center.name)
      await save(result)
      expect((await db.places.toArray()).map((p) => p.name)).toEqual(['Grandma’s'])
    })

    it('picking a town saves no location', async () => {
      const { result, analytics } = await open(captured())
      act(() => result.current.pickSearch(townResult(GALAX)))
      const row = await save(result)
      expect(await db.places.count()).toBe(0)
      expect(row).toMatchObject({ ...placeOf(GALAX), place_id: null, place_origin: 'picked' })
      expect(analytics.sends().map((e) => e.name)).toEqual(['recording_place_set'])
    })

    it('a pick and the saved location it makes wait for Save, and Cancel leaves nothing', async () => {
      const { result } = await open(captured())
      const before = await db.recordings.get('r1')
      act(() => result.current.pickNearby({ kind: 'venue', venue: rex }))
      act(() => result.current.nameLocation('Tom’s kitchen'))
      act(() => result.current.close())
      await expect.poll(() => result.current.closing).toBe(true)
      expect(await db.places.count()).toBe(0)
      expect(await db.recordings.get('r1')).toEqual(before)
      expect(await db.outbox.count()).toBe(0)
    })

    it('a linked recording with no name of its own shows the saved name and is not unnamed', async () => {
      const barn = placeRow('p1', 'The barn', { lat: spot.lat, lon: spot.lon, address: street })
      const { result } = await open(captured({ place_name: null, place_id: 'p1' }), [barn])
      await expect.poll(() => result.current.place?.name).toBe('The barn')
      expect(result.current.placeAddress).toBe(street)
      expect(result.current.canClearPlace).toBe(true)
      expect(result.current.dirty).toBe(false)
      act(() => result.current.setName('Jam'))
      const row = await save(result)
      expect(row).toMatchObject({ place_id: 'p1', place_name: null, place_accuracy_m: 12 })
    })

    it('follows a rename of its saved location while open', async () => {
      const barn = placeRow('p1', 'The barn', { lat: spot.lat, lon: spot.lon })
      const { result } = await open(captured({ place_id: 'p1' }), [barn])
      await expect.poll(() => result.current.place?.name).toBe('The barn')
      await renameSavedPlace(db, 'p1', 'Barn dance hall')
      await expect.poll(() => result.current.place?.name).toBe('Barn dance hall')
      expect(result.current.dirty).toBe(false)
    })

    it('naming over a staged search pick saves at the picked point', async () => {
      const { result } = await open(captured())
      act(() => result.current.pickSearch(townResult(jalopy)))
      expect(result.current.placePoint).toEqual({
        lat: jalopy.lat,
        lon: jalopy.lon,
        accuracyM: null,
      })
      expect(result.current.mapsPoint).toEqual({
        lat: jalopy.lat,
        lon: jalopy.lon,
        accuracyM: null,
      })
      act(() => result.current.nameLocation('Back room'))
      expect(result.current.placePoint).toEqual({
        lat: jalopy.lat,
        lon: jalopy.lon,
        accuracyM: null,
      })
      const row = await save(result)
      const [place] = await db.places.toArray()
      expect(place).toMatchObject({ lat: jalopy.lat, lon: jalopy.lon })
      expect(row).toMatchObject({
        ...placeOf(jalopy),
        place_accuracy_m: null,
        place_id: place!.id,
      })
    })

    it('a nearby venue over a staged search pick keeps the picked point', async () => {
      const { result } = await open(captured())
      act(() => result.current.pickSearch(townResult(jalopy)))
      act(() => result.current.pickNearby({ kind: 'venue', venue: rex }))
      expect(result.current.placePoint).toEqual({
        lat: jalopy.lat,
        lon: jalopy.lon,
        accuracyM: null,
      })
      const row = await save(result)
      const [place] = await db.places.toArray()
      expect(place).toMatchObject({ lat: rex.lat, lon: rex.lon })
      expect(row).toMatchObject({
        place_lat: jalopy.lat,
        place_lon: jalopy.lon,
        place_id: place!.id,
      })
    })

    it('a search pick of a location saved already links it', async () => {
      const saved = placeRow('p1', 'Jalopy Theatre', { lat: jalopy.lat, lon: jalopy.lon })
      const { result, analytics } = await open(captured(), [saved])
      act(() => result.current.pickSearch(jalopyResult))
      expect(result.current.place?.name).toBe('Jalopy Theatre')
      const row = await save(result)
      expect((await db.places.toArray()).map((p) => p.id)).toEqual(['p1'])
      expect(row).toMatchObject({ ...placeOf(jalopy), place_id: 'p1' })
      expect(analytics.sends().map((e) => e.name)).toEqual(['recording_place_set'])
    })

    it('a search pick before the saved locations are read still links a saved one', async () => {
      await db.recordings.put(captured().recording)
      await db.places.put(placeRow('p1', 'Jalopy Theatre', { lat: jalopy.lat, lon: jalopy.lon }))
      const { result, analytics } = setup(captured())
      // Picked in the first render, before the saved locations are read.
      expect(result.current.savedPlaces).toEqual([])
      act(() => result.current.pickSearch(jalopyResult))
      const row = await save(result)
      expect(await db.places.count()).toBe(1)
      expect(row.place_id).toBe('p1')
      expect(analytics.sends().map((e) => e.name)).not.toContain('saved_location_created')
    })

    it('naming a recording picked by hand saves no address', async () => {
      const { result } = await open(
        viewOf({ ...placeOf(jalopy), place_origin: 'picked', place_accuracy_m: null }),
      )
      act(() => result.current.nameLocation('Back room'))
      expect(result.current.placeAddress).toBeNull()
      await save(result)
      expect((await db.places.toArray())[0]?.address).toBeNull()
    })

    it('a picked saved location deleted meanwhile falls back to the recording’s own', async () => {
      const barn = placeRow('p1', 'The barn', { lat: spot.lat, lon: spot.lon })
      const { result } = await open(captured(), [barn])
      act(() => result.current.pickSaved(result.current.savedPlaces[0]!))
      await expect.poll(() => result.current.place?.name).toBe('The barn')
      await deleteSavedPlace(db, 'p1')
      await expect.poll(() => result.current.place?.name).toBe(street)
      expect(result.current.dirty).toBe(false)
      act(() => result.current.setName('Jam'))
      const row = await save(result)
      expect(row).toMatchObject({ place_id: null, place_accuracy_m: 12 })
    })

    it('a search pick linked to a saved location deleted meanwhile saves its own', async () => {
      const saved = placeRow('p1', 'Jalopy Theatre', { lat: jalopy.lat, lon: jalopy.lon })
      const { result, analytics } = await open(captured(), [saved])
      act(() => result.current.pickSearch(jalopyResult))
      await expect.poll(() => result.current.linkedPlace?.id).toBe('p1')
      await deleteSavedPlace(db, 'p1')
      await expect.poll(() => result.current.linkedPlace).toBeNull()
      expect(result.current.place).toEqual(jalopy)
      const row = await save(result)
      const made = (await db.places.toArray()).find((p) => !p.deleted_at)!
      expect(made).toMatchObject({ name: 'Jalopy Theatre', address: jalopyResult.address })
      expect(row).toMatchObject({ ...placeOf(jalopy), place_id: made.id })
      expect(analytics.sends()).toContainEqual({
        name: 'saved_location_created',
        props: { method: 'search' },
      })
    })

    it('a saved pick over a staged search pick keeps the recording’s own point', async () => {
      const barn = placeRow('p1', 'The barn', { lat: 36.67, lon: -80.93 })
      const { result } = await open(captured(), [barn])
      act(() => result.current.pickSearch(townResult(jalopy)))
      act(() => result.current.pickSaved(result.current.savedPlaces[0]!))
      expect(result.current.placePoint).toEqual(spot)
      const row = await save(result)
      expect(row).toMatchObject({
        place_lat: spot.lat,
        place_lon: spot.lon,
        place_accuracy_m: 12,
        place_name: street,
        place_id: 'p1',
      })
    })

    it('a link over a pick whose location is deleted falls back to the pick', async () => {
      const barn = placeRow('p1', 'The barn', { lat: 40.6846, lon: -74.0018 })
      const { result, analytics } = await open(captured(), [barn])
      act(() => result.current.pickSearch(townResult(jalopy)))
      act(() => result.current.pickNearby({ kind: 'saved', place: result.current.savedPlaces[0]! }))
      await expect.poll(() => result.current.place?.name).toBe('The barn')
      await deleteSavedPlace(db, 'p1')
      await expect.poll(() => result.current.place).toEqual(jalopy)
      expect(result.current.dirty).toBe(true)
      const row = await save(result)
      expect(row).toMatchObject({ ...placeOf(jalopy), place_id: null })
      // The search pick is what was written, so it is what the event says.
      expect(analytics.sends()).toContainEqual({
        name: 'recording_place_set',
        props: { method: 'search', recording_id: 'r1', replaced: true },
      })
    })

    it('reads replaced from the location as it is now', async () => {
      await db.recordings.put(viewOf().recording)
      const { result, analytics } = setup(viewOf())
      await db.recordings.update('r1', { ...placeOf(GALAX) })
      await expect.poll(() => result.current.place).toEqual(GALAX)
      act(() => result.current.pickSearch(townResult(AIRY)))
      await save(result)
      expect(analytics.sends()).toContainEqual({
        name: 'recording_place_set',
        props: { method: 'search', recording_id: 'r1', replaced: true },
      })
    })

    it('a linked recording leaves the recent locations', async () => {
      const barn = placeRow('p1', 'The barn', { lat: spot.lat, lon: spot.lon })
      await db.recordings.put({ ...captured({ place_id: 'p1' }).recording, id: 'r2' })
      const other = viewOf({ ...placeOf(GALAX), added_at: '2026-03-01T12:00:00.000Z' })
      const { result } = await open(other, [barn])
      await expect.poll(() => result.current.recentPlaces).toEqual([GALAX])
    })

    it('never sends any part of the location', async () => {
      const { result, analytics } = await open(captured())
      act(() => result.current.pickNearby({ kind: 'venue', venue: rex }))
      await save(result)
      const text = JSON.stringify(analytics.sends())
      for (const part of [rex.name, rex.address, String(rex.lat), street, 'Galax']) {
        expect(text).not.toContain(part)
      }
    })
  })
})

function placeOf(place: PlaceChoice) {
  return { place_name: place.name, place_lat: place.lat, place_lon: place.lon }
}
