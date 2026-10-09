import { storedAudioQualityValue } from '../db/recordings'
import { getKeepOffline, getStorage } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import {
  storedInstruments,
  storedNewTuneGenre,
  storedNewTuneStatusValue,
  storedPlayFirstValue,
  storedSearchProviderValues,
} from '../db/types'
import { readAppearance, readTextSize, type Appearance, type TextSize } from '../theme/appearance'
import { settingsId } from '../commands/settings'
import { bytesBucket, countBucket } from './buckets'
import {
  AUDIO_QUALITIES,
  INSTRUMENTS,
  PLAY_FIRSTS,
  SERVICES,
  TUNE_FIELDS,
  TUNE_STATUSES,
  textSizeOffset,
  type AudioQuality,
  type Instrument,
  type PersonProperties,
  type PlayFirst,
  type Service,
  type TuneField,
  type TuneStatus,
} from './events'

/** The settings the web reports, as stored; unknown values are filtered when they are reported. */
export interface WebSettings {
  instruments: readonly string[]
  audioQuality: string
  searchProviders: readonly string[]
  playFirst: string
  appearance: Appearance
  textSize: TextSize
  downloadAll: boolean
  newTuneStatus: string
  /** Only whether a genre is set: the genre is free text, which analytics never carries. */
  newTuneGenreSet: boolean
}

export async function readWebSettings(db: CrosstuneDb, userId: string): Promise<WebSettings> {
  const row = await db.user_settings.get(settingsId(userId))
  return {
    instruments: storedInstruments(row) ?? [],
    audioQuality: storedAudioQualityValue(row),
    searchProviders: storedSearchProviderValues(row),
    playFirst: storedPlayFirstValue(row),
    appearance: readAppearance(),
    textSize: readTextSize(),
    downloadAll: await getKeepOffline(db),
    newTuneStatus: storedNewTuneStatusValue(row),
    newTuneGenreSet: isFilled(storedNewTuneGenre(row)),
  }
}

function isFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function oneOf<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((candidate) => candidate === value)
}

/** The tune fields at least one live tune fills. Status is left out because every tune has one. */
async function fieldsUsed(db: CrosstuneDb): Promise<TuneField[]> {
  const used = new Set<TuneField>()
  const liveTuneIds = new Set<string>()
  await db.tunes
    .filter((tune) => !tune.deleted_at)
    .each((tune) => {
      liveTuneIds.add(tune.id)
      if (isFilled(tune.title)) used.add('title')
      if (tune.alternate_titles.length > 0) used.add('alternate_titles')
      if (tune.modes.length > 0) used.add('mode')
      if (tune.is_crooked) used.add('is_crooked')
      const strings: [TuneField, string | null | undefined][] = [
        ['key', tune.key],
        ['genre', tune.genre],
        ['tune_type', tune.tune_type],
        ['time_signature', tune.time_signature],
        ['part_structure', tune.part_structure],
        ['composer', tune.composer],
        ['lyrics', tune.lyrics],
      ]
      for (const [field, value] of strings) if (isFilled(value)) used.add(field)
      for (const entry of Object.values(tune.tunings ?? {})) {
        const tuning = entry as { tuning?: string | null; capo?: number | null } | null
        if (isFilled(tuning?.tuning)) used.add('tuning')
        if (typeof tuning?.capo === 'number') used.add('capo')
      }
    })
  await db.user_tunes
    .filter((row) => !row.deleted_at && liveTuneIds.has(row.tune_id))
    .each((row) => {
      if (isFilled(row.notes)) used.add('notes')
      if (isFilled(row.learned_from)) used.add('learned_from')
      if (isFilled(row.learned_on)) used.add('learned_on')
    })
  return TUNE_FIELDS.filter((field) => used.has(field))
}

/**
 * What the web reports about the musician: bucketed catalog figures and the current settings.
 * Until a sync has stored the account's figures only the device-local settings are reported.
 */
export async function personProperties(
  db: CrosstuneDb,
  settings: WebSettings,
): Promise<PersonProperties> {
  const storage = await getStorage(db)
  const deviceLocal: PersonProperties = {
    setting_appearance: settings.appearance,
    setting_text_size: textSizeOffset(settings.textSize),
  }
  // A store the first sync has not filled is empty, not the account's, and reporting it would
  // overwrite the figures other devices set on the same person.
  if (!storage) return deviceLocal
  const [catalog, fields] = await Promise.all([
    db.user_tunes.filter((row) => !row.deleted_at).count(),
    fieldsUsed(db),
  ])
  const instruments = INSTRUMENTS.filter((i): i is Instrument => settings.instruments.includes(i))
  const services = new Set<Service>(
    settings.searchProviders.map((value) => oneOf(SERVICES, value) ?? 'other'),
  )
  const audioQuality: AudioQuality | undefined = oneOf(AUDIO_QUALITIES, settings.audioQuality)
  const playFirst: PlayFirst | undefined = oneOf(PLAY_FIRSTS, settings.playFirst)
  const newTuneStatus: TuneStatus | undefined = oneOf(TUNE_STATUSES, settings.newTuneStatus)
  return {
    ...deviceLocal,
    catalog_size: countBucket(catalog),
    fields_used: fields,
    storage_used: bytesBucket(storage.used_bytes),
    setting_instruments: instruments,
    ...(audioQuality ? { setting_audio_quality: audioQuality } : {}),
    setting_search_providers: SERVICES.filter((service) => services.has(service)),
    ...(playFirst ? { setting_play_first: playFirst } : {}),
    setting_download_all: settings.downloadAll,
    ...(newTuneStatus ? { setting_new_tune_status: newTuneStatus } : {}),
    setting_new_tune_genre_set: settings.newTuneGenreSet,
  }
}
