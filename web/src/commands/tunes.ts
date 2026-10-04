import type { Mode, TuneStatus, TimeSignature } from '../api/vocabulary'
import type { CrosstuneDb } from '../db/schema'
import type { PlayerItem } from '../features/player/usePlayer'
import type { TuningsMap } from '../features/settings/instruments'
import { TUNE_NOT_FOUND } from './messages'
import { tombstoneTuneRecordings } from './recordings'
import {
  defined,
  newId,
  now,
  putRow,
  recordingTx,
  tombstone,
  tombstoneWhere,
  writeTx,
} from './write'

export interface TuneInput {
  title: string
  alternate_titles?: string[]
  genre?: string | null
  lyrics?: string | null
  key?: string | null
  tune_type?: string | null
  modes?: Mode[]
  composer?: string | null
  tunings?: TuningsMap
  part_structure?: string | null
  time_signature?: TimeSignature | null
  is_crooked?: boolean
}

export interface UserTuneInput {
  status: TuneStatus
  learned_from?: string | null
  learned_on?: string | null
  notes?: string | null
}

export async function createTune(
  db: CrosstuneDb,
  tune: TuneInput,
  userTune: UserTuneInput,
): Promise<{ tuneId: string; userTuneId: string }> {
  const title = tune.title.trim()
  if (!title) throw new Error('A tune needs a title')
  const at = now()
  const tuneId = newId()
  const userTuneId = newId()
  await writeTx(db, async () => {
    await putRow(db, 'tunes', {
      id: tuneId,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      title,
      alternate_titles: tune.alternate_titles ?? [],
      genre: tune.genre ?? null,
      lyrics: tune.lyrics ?? null,
      key: tune.key ?? null,
      tune_type: tune.tune_type ?? null,
      modes: tune.modes ?? [],
      composer: tune.composer ?? null,
      tunings: tune.tunings ?? {},
      part_structure: tune.part_structure ?? null,
      time_signature: tune.time_signature ?? null,
      is_crooked: tune.is_crooked ?? false,
    })
    await putRow(db, 'user_tunes', {
      id: userTuneId,
      created_at: at,
      updated_at: at,
      deleted_at: null,
      server_seq: 0,
      tune_id: tuneId,
      status: userTune.status,
      learned_from: userTune.learned_from ?? null,
      learned_on: userTune.learned_on ?? null,
      notes: userTune.notes ?? null,
      archived_at: null,
    })
  })
  return { tuneId, userTuneId }
}

export async function updateTune(
  db: CrosstuneDb,
  tuneId: string,
  patch: Partial<TuneInput>,
): Promise<void> {
  const changes = defined(patch)
  if (changes.title !== undefined) {
    changes.title = changes.title.trim()
    if (!changes.title) throw new Error('A tune needs a title')
  }
  await writeTx(db, async () => {
    const tune = await db.tunes.get(tuneId)
    if (!tune || tune.deleted_at) throw new Error(TUNE_NOT_FOUND)
    await putRow(db, 'tunes', { ...tune, ...changes, updated_at: now() })
  })
}

export async function updateUserTune(
  db: CrosstuneDb,
  userTuneId: string,
  patch: Partial<UserTuneInput>,
): Promise<void> {
  const changes = defined(patch)
  await writeTx(db, async () => {
    const userTune = await db.user_tunes.get(userTuneId)
    if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
    await putRow(db, 'user_tunes', { ...userTune, ...changes, updated_at: now() })
  })
}

/** Saves an edit to a tune and the musician's own row for it, both or neither. */
export async function updateTuneEntry(
  db: CrosstuneDb,
  ids: { tuneId: string; userTuneId: string },
  tune: Partial<TuneInput>,
  userTune: Partial<UserTuneInput>,
): Promise<void> {
  // Each update opens its own writeTx, which Dexie runs inside this one as a nested transaction.
  await writeTx(db, async () => {
    await updateTune(db, ids.tuneId, tune)
    await updateUserTune(db, ids.userTuneId, userTune)
  })
}

export async function setArchived(
  db: CrosstuneDb,
  userTuneId: string,
  archived: boolean,
): Promise<void> {
  const at = now()
  await writeTx(db, async () => {
    const userTune = await db.user_tunes.get(userTuneId)
    if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
    await putRow(db, 'user_tunes', {
      ...userTune,
      archived_at: archived ? at : null,
      updated_at: at,
    })
  })
}

/** Pin one recording or link as what the tune plays in a list, or pass null to clear the pin. */
export async function setPlaySource(
  db: CrosstuneDb,
  userTuneId: string,
  source: PlayerItem | null,
): Promise<void> {
  await writeTx(db, async () => {
    const userTune = await db.user_tunes.get(userTuneId)
    if (!userTune || userTune.deleted_at) throw new Error(TUNE_NOT_FOUND)
    await putRow(db, 'user_tunes', {
      ...userTune,
      play_recording_id: source?.kind === 'recording' ? source.id : null,
      play_link_id: source?.kind === 'link' ? source.id : null,
      updated_at: now(),
    })
  })
}

/**
 * A tune and everything that hangs off it. Call inside a `recordingTx`, which is what deleting
 * one tune and deleting a selection of them share.
 */
export async function tombstoneTune(db: CrosstuneDb, tuneId: string, at: string): Promise<void> {
  await tombstone(db, 'tunes', tuneId, at)
  const userTuneIds = await db.user_tunes.where('tune_id').equals(tuneId).primaryKeys()
  for (const userTuneId of userTuneIds) {
    await tombstoneWhere(db, 'list_items', 'user_tune_id', userTuneId, at)
    await tombstone(db, 'user_tunes', userTuneId, at, { enqueueDelete: false })
  }
  await tombstoneWhere(db, 'recording_links', 'tune_id', tuneId, at)
  await tombstoneWhere(db, 'notation_pages', 'tune_id', tuneId, at)
  await tombstoneTuneRecordings(db, tuneId, at)
}

export async function deleteTune(db: CrosstuneDb, tuneId: string): Promise<void> {
  const at = now()
  await recordingTx(db, () => tombstoneTune(db, tuneId, at))
}
