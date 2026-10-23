import { v5 as uuidv5 } from 'uuid'
import {
  INSTRUMENTS,
  type AudioQuality,
  type Instrument,
  type PlayFirst,
  type Provider,
  type TuneStatus,
  USER_SETTINGS_RANGES,
} from '../api/vocabulary'
import { storedAudioQualityValue } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import {
  isInstrument,
  storedInstruments,
  storedNewTuneGenre,
  storedNewTuneStatusValue,
  storedPlayFirstValue,
  SEARCHABLE_PROVIDERS,
  storedSearchProviderValues,
  storedTunerA4Hz,
  type LocalUserSettings,
} from '../db/types'
import { now, putRow, writeTx } from './write'

// Every device derives the same id for a user's single settings row, so offline
// edits on two devices converge by last-write-wins instead of colliding.
const SETTINGS_NAMESPACE = '5d1c0b8a-3e7f-4a92-9c64-2b8e1f0a7d33'

export function settingsId(clerkUserId: string): string {
  return uuidv5(clerkUserId, SETTINGS_NAMESPACE)
}

/** Known instruments in canonical order, then each unrecognized value once, in first-seen order. */
function normalizeInstruments(values: readonly string[]): string[] {
  const set = new Set(values)
  const known = INSTRUMENTS.filter((i) => set.has(i))
  const unknown = [...set].filter((v) => !isInstrument(v))
  return [...known, ...unknown]
}

/** Store the row and queue its upsert. Call inside writeTx with the row as read there. */
async function writeSettings(
  db: CrosstuneDb,
  id: string,
  existing: LocalUserSettings | undefined,
  patch: {
    instruments?: readonly string[]
    audio_quality?: AudioQuality
    search_providers?: readonly string[]
    play_first?: PlayFirst
    new_tune_genre?: string | null
    new_tune_status?: TuneStatus
    tuner_a4_hz?: number
  },
): Promise<void> {
  const at = now()
  await putRow(db, 'user_settings', {
    ...existing,
    id,
    created_at: existing?.created_at ?? at,
    updated_at: at,
    deleted_at: null,
    server_seq: existing?.server_seq ?? 0,
    instruments: normalizeInstruments(patch.instruments ?? storedInstruments(existing) ?? []),
    audio_quality: patch.audio_quality ?? storedAudioQualityValue(existing),
    play_first: patch.play_first ?? storedPlayFirstValue(existing),
    search_providers: [...(patch.search_providers ?? storedSearchProviderValues(existing))],
    new_tune_genre:
      patch.new_tune_genre === undefined ? storedNewTuneGenre(existing) : patch.new_tune_genre,
    new_tune_status: patch.new_tune_status ?? storedNewTuneStatusValue(existing),
    tuner_a4_hz: patch.tuner_a4_hz ?? storedTunerA4Hz(existing),
  })
}

export async function setInstruments(
  db: CrosstuneDb,
  clerkUserId: string,
  instruments: readonly Instrument[],
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), { instruments })
  })
}

/**
 * Toggle one instrument on the stored row, computed from the row as read inside this
 * transaction so a second toggle issued before the first settles still sees the first's
 * write instead of a stale snapshot from before either began.
 */
export async function toggleInstrumentSetting(
  db: CrosstuneDb,
  clerkUserId: string,
  instrument: Instrument,
  on: boolean,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    const existing = await db.user_settings.get(id)
    const next = new Set(storedInstruments(existing) ?? [])
    if (on) next.add(instrument)
    else next.delete(instrument)
    await writeSettings(db, id, existing, { instruments: [...next] })
  })
}

export async function setAudioQuality(
  db: CrosstuneDb,
  clerkUserId: string,
  quality: AudioQuality,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), { audio_quality: quality })
  })
}

export async function setPlayFirst(
  db: CrosstuneDb,
  clerkUserId: string,
  playFirst: PlayFirst,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), { play_first: playFirst })
  })
}

/**
 * The genre a new tune starts with; a blank one means none. Kept as typed, since the settings
 * field writes on every keystroke and trimming would drop a space typed between two words.
 */
export async function setNewTuneGenre(
  db: CrosstuneDb,
  clerkUserId: string,
  genre: string | null,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), {
      new_tune_genre: genre?.trim() ? genre : null,
    })
  })
}

export async function setNewTuneStatus(
  db: CrosstuneDb,
  clerkUserId: string,
  status: TuneStatus,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), { new_tune_status: status })
  })
}

/** Toggle one searched service, read inside the transaction like `toggleInstrumentSetting`. */
export async function toggleSearchProvider(
  db: CrosstuneDb,
  clerkUserId: string,
  provider: Provider,
  on: boolean,
): Promise<void> {
  const id = settingsId(clerkUserId)
  await writeTx(db, async () => {
    const existing = await db.user_settings.get(id)
    const next = new Set(storedSearchProviderValues(existing))
    if (on && provider !== 'other') next.add(provider)
    else next.delete(provider)
    const known = SEARCHABLE_PROVIDERS.filter((p) => next.has(p))
    const unknown = [...next].filter((v) => !SEARCHABLE_PROVIDERS.some((p) => p === v))
    await writeSettings(db, id, existing, { search_providers: [...known, ...unknown] })
  })
}

/** Sets the pitch the tuner takes A4 to be, a whole number held within the allowed range. */
export async function setTunerA4Hz(
  db: CrosstuneDb,
  clerkUserId: string,
  hz: number,
): Promise<void> {
  const id = settingsId(clerkUserId)
  const { min, max } = USER_SETTINGS_RANGES.tuner_a4_hz
  const held = Math.min(Math.max(Math.round(hz), min), max)
  await writeTx(db, async () => {
    await writeSettings(db, id, await db.user_settings.get(id), { tuner_a4_hz: held })
  })
}
