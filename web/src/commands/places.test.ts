import { beforeEach, describe, expect, it } from 'vitest'
import { PLACE_LIMITS } from '../api/vocabulary'
import { pendingFor } from '../db/outbox'
import type { CrosstuneDb } from '../db/schema'
import { openTestDb } from '../test/db'
import { placeRow, recordingRow } from '../test/rows'
import { PLACE_NAME_REQUIRED, PLACE_NOT_FOUND, RECORDING_NOT_FOUND } from './messages'
import {
  createSavedPlace,
  deleteSavedPlace,
  editRecording,
  linkRecordingPlace,
  renameSavedPlace,
  setRecordingPlace,
} from './places'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const venue = { name: 'The Barn', lat: 36.5, lon: -80.5, address: null, applePlaceId: null }

describe('saved places', () => {
  it('create, rename, and delete queue pushes', async () => {
    const place = await createSavedPlace(db, {
      name: '  The Barn  ',
      lat: 36.5,
      lon: -80.5,
      address: ' 1 Main St ',
      applePlaceId: 'I123',
    })
    expect(place).toMatchObject({
      name: 'The Barn',
      lat: 36.5,
      lon: -80.5,
      address: '1 Main St',
      apple_place_id: 'I123',
      deleted_at: null,
    })
    expect(await db.places.get(place.id)).toEqual(place)
    expect(await pendingFor(db, 'places', place.id)).toMatchObject({
      op: 'upsert',
      data: { name: 'The Barn', lat: 36.5, lon: -80.5, address: '1 Main St' },
    })

    await renameSavedPlace(db, place.id, ' Barn Dance Hall ')
    expect((await db.places.get(place.id))?.name).toBe('Barn Dance Hall')
    expect(await pendingFor(db, 'places', place.id)).toMatchObject({
      op: 'upsert',
      data: { name: 'Barn Dance Hall' },
    })

    await deleteSavedPlace(db, place.id)
    expect((await db.places.get(place.id))?.deleted_at).not.toBeNull()
    expect(await pendingFor(db, 'places', place.id)).toMatchObject({ op: 'delete' })
  })

  it('stores a blank address and Apple id as null and clips by code points', async () => {
    const long = '🎻'.repeat(PLACE_LIMITS.name + 5)
    const place = await createSavedPlace(db, {
      ...venue,
      name: long,
      address: '  ',
      applePlaceId: '',
    })
    expect([...place.name]).toHaveLength(PLACE_LIMITS.name)
    expect(place.address).toBeNull()
    expect(place.apple_place_id).toBeNull()
    const renamed = 'x'.repeat(PLACE_LIMITS.name + 1)
    await renameSavedPlace(db, place.id, renamed)
    expect((await db.places.get(place.id))?.name).toHaveLength(PLACE_LIMITS.name)
  })

  it('refuses a blank name', async () => {
    await expect(createSavedPlace(db, { ...venue, name: '   ' })).rejects.toThrow(
      PLACE_NAME_REQUIRED,
    )
    await db.places.put(placeRow('p1', 'Barn'))
    await expect(renameSavedPlace(db, 'p1', ' ')).rejects.toThrow(PLACE_NAME_REQUIRED)
    expect(await db.outbox.count()).toBe(0)
  })

  it('rename and delete throw for a missing or deleted place', async () => {
    await db.places.put(placeRow('gone', 'Barn', { deleted_at: '2026-02-01T00:00:00.000Z' }))
    for (const id of ['nope', 'gone']) {
      await expect(renameSavedPlace(db, id, 'X')).rejects.toThrow(PLACE_NOT_FOUND)
      await expect(deleteSavedPlace(db, id)).rejects.toThrow(PLACE_NOT_FOUND)
    }
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('setRecordingPlace', () => {
  const taken = (extra = {}) =>
    recordingRow('rec-1', {
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
      place_accuracy_m: 12,
      place_origin: 'device',
      ...extra,
    })

  it("a nearby pick keeps the recording's coordinates and links", async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('p1', 'The Barn', { lat: 36.5, lon: -80.5 }))
    await setRecordingPlace(db, 'rec-1', { kind: 'nearby', place: (await db.places.get('p1'))! })
    const expected = {
      place_id: 'p1',
      place_origin: 'picked',
      place_name: 'Galax, VA',
      place_lat: 36.66,
      place_lon: -80.92,
      place_accuracy_m: 12,
    }
    expect(await db.recordings.get('rec-1')).toMatchObject(expected)
    expect((await pendingFor(db, 'recordings', 'rec-1'))?.data).toMatchObject(expected)
  })

  it('a saved pick lends its point to a recording with none', async () => {
    await db.recordings.put(
      taken({
        place_name: null,
        place_lat: null,
        place_lon: null,
        place_accuracy_m: null,
        place_origin: null,
      }),
    )
    await db.places.put(placeRow('p1', 'The Barn', { lat: 36.5, lon: -80.5 }))
    await setRecordingPlace(db, 'rec-1', { kind: 'saved', place: (await db.places.get('p1'))! })
    expect(await db.recordings.get('rec-1')).toMatchObject({
      place_id: 'p1',
      place_origin: 'picked',
      place_name: null,
      place_lat: 36.5,
      place_lon: -80.5,
      place_accuracy_m: null,
    })
  })

  it('a search pick replaces coordinates and unlinks', async () => {
    await db.recordings.put(taken({ place_id: 'p0' }))
    await setRecordingPlace(db, 'rec-1', {
      kind: 'search',
      place: { name: 'Floyd, VA', lat: 36.9, lon: -80.3, accuracyM: null },
    })
    const expected = {
      place_id: null,
      place_origin: 'picked',
      place_name: 'Floyd, VA',
      place_lat: 36.9,
      place_lon: -80.3,
      place_accuracy_m: null,
    }
    expect(await db.recordings.get('rec-1')).toMatchObject(expected)
    expect((await pendingFor(db, 'recordings', 'rec-1'))?.data).toMatchObject(expected)
  })

  it('a search pick links the saved place it names', async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('p1', 'The Barn'))
    await setRecordingPlace(db, 'rec-1', {
      kind: 'search',
      place: { name: 'The Barn', lat: 36.5, lon: -80.5, accuracyM: null },
      savedPlaceId: 'p1',
    })
    expect(await db.recordings.get('rec-1')).toMatchObject({
      place_id: 'p1',
      place_origin: 'picked',
      place_lat: 36.5,
    })
  })

  it('refuses a deleted or missing saved place and a missing recording', async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('gone', 'Barn', { deleted_at: '2026-02-01T00:00:00.000Z' }))
    const gone = (await db.places.get('gone'))!
    await expect(setRecordingPlace(db, 'rec-1', { kind: 'nearby', place: gone })).rejects.toThrow(
      PLACE_NOT_FOUND,
    )
    await expect(
      setRecordingPlace(db, 'rec-1', {
        kind: 'search',
        place: { name: 'X', lat: 1, lon: 2, accuracyM: null },
        savedPlaceId: 'nope',
      }),
    ).rejects.toThrow(PLACE_NOT_FOUND)
    await expect(setRecordingPlace(db, 'nope', { kind: 'nearby', place: gone })).rejects.toThrow(
      RECORDING_NOT_FOUND,
    )
    expect(await db.recordings.get('rec-1')).toEqual(taken())
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('linkRecordingPlace', () => {
  const street = '200 Eastern Pkwy, Brooklyn, NY'
  const taken = () =>
    recordingRow('rec-1', {
      place_name: street,
      place_lat: 40.6718,
      place_lon: -73.9635,
      place_accuracy_m: 12,
      place_origin: 'device',
    })
  const jalopy = {
    name: 'Jalopy Theatre, 315 Columbia St, Brooklyn, NY',
    lat: 40.6845,
    lon: -74.0019,
  }
  const jalopyDraft = {
    name: 'Jalopy Theatre',
    address: '315 Columbia St, Brooklyn, NY',
    lat: jalopy.lat,
    lon: jalopy.lon,
    applePlaceId: null,
  }

  it('a search pick of a venue saves it and links the recording at the pick', async () => {
    await db.recordings.put(taken())
    const made = await linkRecordingPlace(db, 'rec-1', {
      kind: 'search',
      place: jalopy,
      saving: jalopyDraft,
    })
    expect(made).toBe(true)
    const [place] = await db.places.toArray()
    expect(place).toMatchObject({ name: 'Jalopy Theatre', address: jalopyDraft.address })
    expect(await db.recordings.get('rec-1')).toMatchObject({
      place_id: place!.id,
      place_name: jalopy.name,
      place_lat: jalopy.lat,
      place_lon: jalopy.lon,
      place_accuracy_m: null,
      place_origin: 'picked',
    })
  })

  it('a search pick links a live saved place with its Apple id rather than saving twice', async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('p1', 'Jalopy', { lat: 0, lon: 0, apple_place_id: 'J1' }))
    const made = await linkRecordingPlace(db, 'rec-1', {
      kind: 'search',
      place: jalopy,
      saving: { ...jalopyDraft, applePlaceId: 'J1' },
    })
    expect(made).toBe(false)
    expect((await db.places.toArray()).map((p) => p.id)).toEqual(['p1'])
    expect((await db.recordings.get('rec-1'))?.place_id).toBe('p1')
  })

  it('a search pick with no Apple id links a live saved place of its name within 30 m', async () => {
    await db.recordings.put(taken())
    // About 11 m north of the pick.
    await db.places.put(
      placeRow('p1', 'Jalopy Theatre', { lat: jalopy.lat + 0.0001, lon: jalopy.lon }),
    )
    await db.places.put(
      placeRow('far', 'Jalopy Theatre', { lat: jalopy.lat + 0.01, lon: jalopy.lon }),
    )
    expect(
      await linkRecordingPlace(db, 'rec-1', { kind: 'search', place: jalopy, saving: jalopyDraft }),
    ).toBe(false)
    expect(await db.places.count()).toBe(2)
    expect((await db.recordings.get('rec-1'))?.place_id).toBe('p1')
  })

  it('a search pick with an Apple id links a saved place of its name within 30 m that has none', async () => {
    await db.recordings.put(taken())
    // Saved on a client whose search gives no Apple id, about 11 m north of the pick.
    await db.places.put(
      placeRow('p1', '  jalopy THEATRE ', { lat: jalopy.lat + 0.0001, lon: jalopy.lon }),
    )
    expect(
      await linkRecordingPlace(db, 'rec-1', {
        kind: 'search',
        place: jalopy,
        saving: { ...jalopyDraft, applePlaceId: 'J1' },
      }),
    ).toBe(false)
    expect(await db.places.count()).toBe(1)
    expect((await db.recordings.get('rec-1'))?.place_id).toBe('p1')
  })

  it('a nearby venue or a typed name saved already links that place rather than saving twice', async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('p1', 'Jalopy Theatre', { lat: jalopy.lat, lon: jalopy.lon }))
    for (const method of ['nearby', 'saved'] as const) {
      const made = await linkRecordingPlace(db, 'rec-1', {
        kind: 'create',
        method,
        draft: {
          ...jalopyDraft,
          name: ' JALOPY theatre',
          applePlaceId: method === 'nearby' ? 'J1' : null,
        },
        over: null,
      })
      expect(made).toBe(false)
      expect(await db.places.count()).toBe(1)
      expect((await db.recordings.get('rec-1'))?.place_id).toBe('p1')
    }
  })

  it('a deleted saved place of the same name is no match', async () => {
    await db.recordings.put(taken())
    await db.places.put(
      placeRow('gone', 'Jalopy Theatre', {
        lat: jalopy.lat,
        lon: jalopy.lon,
        deleted_at: '2026-02-01T00:00:00.000Z',
      }),
    )
    expect(
      await linkRecordingPlace(db, 'rec-1', { kind: 'search', place: jalopy, saving: jalopyDraft }),
    ).toBe(true)
    expect(await db.places.count()).toBe(2)
  })

  it('a town search pick saves nothing', async () => {
    await db.recordings.put(taken())
    const town = { name: 'Galax, VA', lat: 36.66, lon: -80.92 }
    expect(
      await linkRecordingPlace(db, 'rec-1', { kind: 'search', place: town, saving: null }),
    ).toBe(false)
    expect(await db.places.count()).toBe(0)
    expect(await db.recordings.get('rec-1')).toMatchObject({ ...placeOf(town), place_id: null })
  })

  it('a nearby venue saves at its own point and the recording keeps its own', async () => {
    await db.recordings.put(taken())
    const made = await linkRecordingPlace(db, 'rec-1', {
      kind: 'create',
      method: 'nearby',
      draft: { ...jalopyDraft, applePlaceId: 'J1' },
      over: null,
    })
    expect(made).toBe(true)
    const [place] = await db.places.toArray()
    expect(place).toMatchObject({ lat: jalopy.lat, lon: jalopy.lon, apple_place_id: 'J1' })
    expect(await db.recordings.get('rec-1')).toMatchObject({
      place_id: place!.id,
      place_name: street,
      place_lat: 40.6718,
      place_accuracy_m: 12,
      place_origin: 'picked',
    })
  })

  it('a link over a pick moves the recording to the pick', async () => {
    await db.recordings.put(taken())
    await db.places.put(placeRow('p1', 'The barn', { lat: 1, lon: 2 }))
    await linkRecordingPlace(db, 'rec-1', {
      kind: 'link',
      method: 'nearby',
      placeId: 'p1',
      over: jalopy,
    })
    expect(await db.recordings.get('rec-1')).toMatchObject({
      ...placeOf(jalopy),
      place_accuracy_m: null,
      place_id: 'p1',
    })
  })

  it('writes nothing when the link fails', async () => {
    await db.recordings.put(taken())
    await expect(
      linkRecordingPlace(db, 'rec-1', {
        kind: 'create',
        method: 'saved',
        draft: { ...jalopyDraft, name: '  ' },
        over: null,
      }),
    ).rejects.toThrow(PLACE_NAME_REQUIRED)
    expect(await db.places.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('editRecording', () => {
  it('writes the fields and the link in one transaction, or neither', async () => {
    await db.recordings.put(recordingRow('rec-1', { label: 'Old' }))
    await expect(
      editRecording(
        db,
        'rec-1',
        { label: 'New' },
        { kind: 'link', method: 'saved', placeId: 'nope', over: null },
      ),
    ).rejects.toThrow(PLACE_NOT_FOUND)
    expect((await db.recordings.get('rec-1'))?.label).toBe('Old')
    expect(await db.outbox.count()).toBe(0)

    await db.places.put(placeRow('p1', 'The barn'))
    expect(
      await editRecording(
        db,
        'rec-1',
        { label: 'New' },
        { kind: 'link', method: 'saved', placeId: 'p1', over: null },
      ),
    ).toBe(false)
    expect(await db.recordings.get('rec-1')).toMatchObject({ label: 'New', place_id: 'p1' })
  })
})

function placeOf(place: { name: string; lat: number; lon: number }) {
  return { place_name: place.name, place_lat: place.lat, place_lon: place.lon }
}
