import { v5 as uuidv5 } from 'uuid'
import { storedAudioQuality, type AudioQuality } from '../db/recordings'
import type { CrosstuneDb } from '../db/schema'
import {
  DEFAULT_INSTRUMENTS,
  INSTRUMENTS,
  isInstrument,
  storedInstruments,
  type Instrument,
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
  patch: { instruments?: readonly string[]; audio_quality?: AudioQuality },
): Promise<void> {
  const at = now()
  await putRow(db, 'user_settings', {
    id,
    created_at: existing?.created_at ?? at,
    updated_at: at,
    deleted_at: null,
    server_seq: existing?.server_seq ?? 0,
    instruments: normalizeInstruments(
      patch.instruments ?? storedInstruments(existing) ?? [...DEFAULT_INSTRUMENTS],
    ),
    audio_quality: patch.audio_quality ?? storedAudioQuality(existing),
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
    const next = new Set(storedInstruments(existing) ?? DEFAULT_INSTRUMENTS)
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
