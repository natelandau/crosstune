import { PLACE_LIMITS } from '../api/vocabulary'
import type { CrosstuneDb } from '../db/schema'
import type { LocalPlace } from '../db/types'
import { distanceM, MATCH_RADIUS_M } from '../domain/placeDistances'
import { PLACE_NAME_REQUIRED, PLACE_NOT_FOUND, RECORDING_NOT_FOUND } from './messages'
import { requeueFailedUpload, updateRecording, type RecordingPlace } from './recordings'
import { newId, now, putRow, recordingTx, tombstone, writeTx } from './write'

/** How a recording's place is chosen. */
export type PlacePick =
  /** A search result: replaces the coordinates and links the saved place made from it, if any. */
  | {
      kind: 'search'
      place: RecordingPlace & { name: string }
      savedPlaceId?: string
    }
  /** A saved place near the take or picked from the list: the take keeps its own coordinates. */
  | { kind: 'nearby' | 'saved'; place: LocalPlace }

/** `text` trimmed and cut to `limit` code points, as the server counts them; null when empty. */
function cleaned(text: string | null | undefined, limit: number): string | null {
  const trimmed = text?.trim()
  return trimmed ? [...trimmed].slice(0, limit).join('') : null
}

/** The live saved place; call inside writeTx. */
async function livePlace(db: CrosstuneDb, id: string): Promise<LocalPlace> {
  const place = await db.places.get(id)
  if (!place || place.deleted_at) throw new Error(PLACE_NOT_FOUND)
  return place
}

export async function createSavedPlace(
  db: CrosstuneDb,
  fields: {
    name: string
    lat: number
    lon: number
    address?: string | null
    applePlaceId?: string | null
  },
): Promise<LocalPlace> {
  const name = cleaned(fields.name, PLACE_LIMITS.name)
  if (!name) throw new Error(PLACE_NAME_REQUIRED)
  const at = now()
  const place: LocalPlace = {
    id: newId(),
    created_at: at,
    updated_at: at,
    deleted_at: null,
    server_seq: 0,
    name,
    lat: fields.lat,
    lon: fields.lon,
    address: cleaned(fields.address, PLACE_LIMITS.address),
    apple_place_id: cleaned(fields.applePlaceId, PLACE_LIMITS.apple_place_id),
  }
  await writeTx(db, async () => {
    await putRow(db, 'places', place)
  })
  return (await db.places.get(place.id)) ?? place
}

/** A saved place's name as a rename stores it, to tell a rename from the name it already has. */
export function savedPlaceName(name: string): string | null {
  return cleaned(name, PLACE_LIMITS.name)
}

export async function renameSavedPlace(db: CrosstuneDb, id: string, name: string): Promise<void> {
  const cleanName = savedPlaceName(name)
  if (!cleanName) throw new Error(PLACE_NAME_REQUIRED)
  await writeTx(db, async () => {
    const place = await livePlace(db, id)
    await putRow(db, 'places', { ...place, name: cleanName, updated_at: now() })
  })
}

/** Takes keep their link, which the server clears; each shows its own name meanwhile. */
export async function deleteSavedPlace(db: CrosstuneDb, id: string): Promise<void> {
  await writeTx(db, async () => {
    await livePlace(db, id)
    await tombstone(db, 'places', id, now())
  })
}

/**
 * Sets a live recording's place from a pick and records that the musician chose it. A saved
 * place picked for a take with no coordinates lends its own point; otherwise the take keeps
 * its coordinates, accuracy, and own name.
 */
export async function setRecordingPlace(
  db: CrosstuneDb,
  recordingId: string,
  pick: PlacePick,
): Promise<void> {
  await recordingTx(db, async () => {
    const row = await db.recordings.get(recordingId)
    if (!row || row.deleted_at) throw new Error(RECORDING_NOT_FOUND)
    const next = { ...row, place_origin: 'picked', updated_at: now() }
    if (pick.kind === 'search') {
      next.place_name = pick.place.name
      next.place_lat = pick.place.lat
      next.place_lon = pick.place.lon
      next.place_accuracy_m = null
      next.place_id = pick.savedPlaceId ? (await livePlace(db, pick.savedPlaceId)).id : null
    } else {
      const place = await livePlace(db, pick.place.id)
      if (row.place_lat == null || row.place_lon == null) {
        next.place_lat = place.lat
        next.place_lon = place.lon
        next.place_accuracy_m = null
      }
      next.place_id = place.id
    }
    await putRow(db, 'recordings', next)
    await requeueFailedUpload(db, recordingId)
  })
}

/** A place picked by hand that a take moves to: its name and point, with no accuracy. */
export type PickedPoint = { name: string; lat: number; lon: number }

/** A saved place a pick makes once the edit is saved. */
export type SavedPlaceDraft = {
  name: string
  address: string | null
  lat: number
  lon: number
  applePlaceId: string | null
}

/**
 * A pick that links a saved place, made first when the pick makes one. A link or a new place
 * `over` a point picked before it moves the take there; with none the take keeps its own.
 */
export type PlaceLink =
  /** A search result, with the saved place it makes when it is a venue or a street address. */
  | { kind: 'search'; place: PickedPoint; saving: SavedPlaceDraft | null }
  | { kind: 'link'; method: 'nearby' | 'saved'; placeId: string; over: PickedPoint | null }
  | { kind: 'create'; method: 'nearby' | 'saved'; draft: SavedPlaceDraft; over: PickedPoint | null }

/** A name as the duplicate rule compares it: trimmed, in one case. */
const nameKey = (name: string) => name.trim().toLowerCase()

/**
 * The live saved place a pick refers to, so a repeat pick links rather than saves twice: the one
 * with its Apple Maps id, else one of its name, trimmed and in any case, within 30 m. The name
 * match also covers an id, since a place saved from a search with no id has none.
 */
export function savedPlaceFor(
  places: readonly LocalPlace[],
  draft: { name: string; lat: number; lon: number; applePlaceId: string | null },
): LocalPlace | undefined {
  const live = places.filter((place) => !place.deleted_at)
  const appleId = cleaned(draft.applePlaceId, PLACE_LIMITS.apple_place_id)
  const byId = appleId ? live.find((place) => place.apple_place_id === appleId) : undefined
  const name = nameKey(draft.name)
  return (
    byId ??
    live.find(
      (place) =>
        nameKey(place.name) === name &&
        distanceM(place.lat, place.lon, draft.lat, draft.lon) <= MATCH_RADIUS_M,
    )
  )
}

const asSearch = (point: PickedPoint) => ({ ...point, accuracyM: null })

/**
 * Writes a pick that links a saved place, making the place first when the pick does, all in one
 * transaction. True when it made one. A draft whose place is saved already, by `savedPlaceFor`,
 * links that one, checked here since the saved places may have changed since the pick.
 */
export async function linkRecordingPlace(
  db: CrosstuneDb,
  recordingId: string,
  link: PlaceLink,
): Promise<boolean> {
  return recordingTx(db, async () => {
    const linked = async (placeId: string, over: PickedPoint | null, method: 'nearby' | 'saved') =>
      setRecordingPlace(
        db,
        recordingId,
        over
          ? { kind: 'search', place: asSearch(over), savedPlaceId: placeId }
          : { kind: method, place: await livePlace(db, placeId) },
      )
    const saved = async (draft: SavedPlaceDraft) => savedPlaceFor(await db.places.toArray(), draft)
    const create = (draft: SavedPlaceDraft) => createSavedPlace(db, draft)
    switch (link.kind) {
      case 'search': {
        const existing = link.saving && (await saved(link.saving))
        const made = !existing && link.saving ? await create(link.saving) : null
        await setRecordingPlace(db, recordingId, {
          kind: 'search',
          place: asSearch(link.place),
          savedPlaceId: (existing ?? made)?.id,
        })
        return made !== null
      }
      case 'link':
        await linked(link.placeId, link.over, link.method)
        return false
      case 'create': {
        const existing = await saved(link.draft)
        await linked((existing ?? (await create(link.draft))).id, link.over, link.method)
        return !existing
      }
    }
  })
}

/**
 * Saves an edit's fields and, when given, the pick that links a saved place, in one
 * transaction, so neither lands without the other. True when the pick made a saved place.
 */
export async function editRecording(
  db: CrosstuneDb,
  recordingId: string,
  patch: Parameters<typeof updateRecording>[2],
  link: PlaceLink | null,
): Promise<boolean> {
  return recordingTx(db, async () => {
    await updateRecording(db, recordingId, patch)
    return link ? linkRecordingPlace(db, recordingId, link) : false
  })
}
