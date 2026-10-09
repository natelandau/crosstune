import type {
  BytesBucket,
  CountBucket,
  DurationBucket,
  ListenedBucket,
  SpeedBucket,
} from './buckets'
import { DISPLAY_MODES, FORM_FACTORS } from './superProperties'

export const SOURCES = [
  'catalog',
  'tune',
  'list',
  'recordings_list',
  'recording_screen',
  'dock',
  'search_offer',
  'menu',
] as const
export const ORIGINS = ['recorded', 'imported', 'slippery_hill'] as const
export const KINDS = ['recorded', 'imported', 'slippery_hill', 'link'] as const
export const QUEUES = ['single', 'playlist'] as const
export const TRIGGERS = ['tap', 'auto_advance', 'skip'] as const
export const ENDED_BYS = ['finished', 'skipped', 'paused', 'closed'] as const
export const REPEATS = ['off', 'list', 'tune'] as const
export const FILED_SOURCES = ['unfiled', 'other_tune'] as const
export const SORTS = ['title', 'added', 'modified', 'played'] as const
export const BULK_ACTIONS = ['status', 'edit', 'archive', 'delete'] as const
export const FAILURE_REASONS = [
  'network',
  'storage_full',
  'auth_expired',
  'server_error',
  'other',
] as const
export const SERVICES = [
  'youtube',
  'spotify',
  'apple_music',
  'bandcamp',
  'soundcloud',
  'tidal',
  'internet_archive',
  'slippery_hill',
  'other',
] as const
export const LINK_VIAS = ['paste', 'find'] as const
export const SCAN_VIAS = ['camera', 'document_scanner', 'photo_library', 'file'] as const
export const TUNE_FIELDS = [
  'title',
  'alternate_titles',
  'status',
  'key',
  'mode',
  'tuning',
  'capo',
  'genre',
  'tune_type',
  'time_signature',
  'part_structure',
  'composer',
  'is_crooked',
  'lyrics',
  'notes',
  'learned_from',
  'learned_on',
] as const
export const FILTERS = [
  'status',
  'key',
  'tune_type',
  'mode',
  'tuning',
  'genre',
  'composer',
  'learned_from',
  'archived',
  'unheard',
  'missing',
] as const
export const AUDIO_FORMATS = ['m4a', 'mp3', 'wav', 'aiff', 'flac', 'other'] as const
export const EXPORT_FORMATS = ['zip'] as const
export const ARCHIVE_SOURCES = ['slippery_hill'] as const
export const AUDIO_QUALITIES = ['low', 'standard', 'high', 'highest'] as const
export const PLAY_FIRSTS = ['recordings', 'apple_music'] as const
export const APPEARANCES = ['system', 'light', 'dark'] as const
export const TUNE_STATUSES = ['known', 'learning', 'want_to_learn'] as const
export const INSTRUMENTS = [
  'violin',
  'five_string_banjo',
  'tenor_banjo',
  'guitar',
  'mandolin',
  'bouzouki',
  'mountain_dulcimer',
] as const

/** The plan's `screen` enum without `stand`, which only the Apple apps have. */
export const SCREENS = [
  'welcome',
  'catalog',
  'tune',
  'lists',
  'list',
  'recordings',
  'recording',
  'find_recordings',
  'settings',
  'stats',
] as const

/** The plan's `setting` enum without `capture_channels`, which only the Apple apps have. */
export const SETTING_NAMES = [
  'instruments',
  'audio_quality',
  'search_providers',
  'play_first',
  'appearance',
  'text_size',
  'download_all',
  'new_tune_status',
  'new_tune_genre_set',
] as const

/** Each enum shared with the plan, keyed by the plan's name, so the contract test can compare them. */
export const ENUMS = {
  form_factor: FORM_FACTORS,
  display_mode: DISPLAY_MODES,
  source: SOURCES,
  origin: ORIGINS,
  kind: KINDS,
  queue: QUEUES,
  trigger: TRIGGERS,
  ended_by: ENDED_BYS,
  repeat: REPEATS,
  filed_from: FILED_SOURCES,
  sort: SORTS,
  bulk_action: BULK_ACTIONS,
  failure_reason: FAILURE_REASONS,
  service: SERVICES,
  link_via: LINK_VIAS,
  scan_via: SCAN_VIAS,
  tune_field: TUNE_FIELDS,
  filter: FILTERS,
  audio_format: AUDIO_FORMATS,
  export_format: EXPORT_FORMATS,
  archive_source: ARCHIVE_SOURCES,
  audio_quality: AUDIO_QUALITIES,
  play_first: PLAY_FIRSTS,
  appearance: APPEARANCES,
  tune_status: TUNE_STATUSES,
  instrument: INSTRUMENTS,
} as const

export type Source = (typeof SOURCES)[number]
export type Origin = (typeof ORIGINS)[number]
export type Kind = (typeof KINDS)[number]
export type Queue = (typeof QUEUES)[number]
export type Trigger = (typeof TRIGGERS)[number]
export type EndedBy = (typeof ENDED_BYS)[number]
export type Repeat = (typeof REPEATS)[number]
export type FiledFrom = (typeof FILED_SOURCES)[number]
export type Sort = (typeof SORTS)[number]
export type BulkAction = (typeof BULK_ACTIONS)[number]
export type FailureReason = (typeof FAILURE_REASONS)[number]
export type Service = (typeof SERVICES)[number]
export type LinkVia = (typeof LINK_VIAS)[number]
export type ScanVia = (typeof SCAN_VIAS)[number]
export type TuneField = (typeof TUNE_FIELDS)[number]
export type Filter = (typeof FILTERS)[number]
export type AudioFormat = (typeof AUDIO_FORMATS)[number]
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export type ArchiveSource = (typeof ARCHIVE_SOURCES)[number]
export type AudioQuality = (typeof AUDIO_QUALITIES)[number]
export type PlayFirst = (typeof PLAY_FIRSTS)[number]
export type Appearance = (typeof APPEARANCES)[number]
export type TuneStatus = (typeof TUNE_STATUSES)[number]
export type Instrument = (typeof INSTRUMENTS)[number]
export type Screen = (typeof SCREENS)[number]
export type SettingName = (typeof SETTING_NAMES)[number]

/** A setting change, discriminated on `setting` so each value has the plan's type for it. */
export type SettingChange =
  | { setting: 'instruments'; value: Instrument[] }
  | { setting: 'audio_quality'; value: AudioQuality }
  | { setting: 'search_providers'; value: Service[] }
  | { setting: 'play_first'; value: PlayFirst }
  | { setting: 'appearance'; value: Appearance }
  | { setting: 'text_size'; value: number }
  | { setting: 'download_all'; value: boolean }
  | { setting: 'new_tune_status'; value: TuneStatus }
  | { setting: 'new_tune_genre_set'; value: boolean }

/** The plan's `text_size` value for a text size: the step from regular. */
export function textSizeOffset(size: 'compact' | 'regular' | 'roomy'): number {
  if (size === 'compact') return -1
  return size === 'roomy' ? 1 : 0
}

type Empty = Record<string, never>

/** Every plan event the web sends, by name. Optional IDs are left out when absent. */
export interface EventProps {
  signed_in: Empty
  signed_out: Empty
  account_deleted: Empty
  account_deletion_started: Empty
  account_deletion_cancelled: Empty
  tune_created: { source: Source; fields_set: TuneField[]; tune_id: string }
  tune_edited: { fields_changed: TuneField[]; tune_id: string }
  tune_status_changed: { from: TuneStatus; to: TuneStatus; tune_id: string }
  tune_archived: { tune_id: string }
  tune_unarchived: { tune_id: string }
  tune_deleted: {
    recordings_count: CountBucket
    links_count: CountBucket
    scans_count: CountBucket
    tune_id: string
  }
  bulk_edit_applied: {
    count_bucket: CountBucket
    action: BulkAction
    fields_changed?: TuneField[]
  }
  search_performed: { result_count_bucket: CountBucket; took_offer: boolean }
  catalog_filtered: { filter: Filter }
  catalog_sorted: { sort: Sort }
  lyrics_opened: { tune_id: string }
  list_created: { list_id: string; count_bucket: CountBucket }
  list_renamed: { list_id: string }
  list_deleted: { list_id: string; count_bucket: CountBucket }
  list_reordered: { list_id: string }
  tunes_added_to_list: { list_id: string; count_bucket: CountBucket }
  tunes_removed_from_list: { list_id: string; count_bucket: CountBucket }
  recording_started: { source: Source }
  recording_saved: {
    duration_bucket: DurationBucket
    filed: boolean
    recording_id: string
    tune_id?: string
  }
  recording_discarded: { duration_bucket: DurationBucket }
  audio_imported: { count_bucket: CountBucket; format: AudioFormat }
  archive_recording_saved: {
    source_archive: ArchiveSource
    recording_id: string
    tune_id: string
  }
  recording_filed: { from: FiledFrom; origin: Origin; recording_id: string; tune_id: string }
  recording_unfiled: { origin: Origin; recording_id: string }
  recording_renamed: { origin: Origin; recording_id: string }
  recording_deleted: { origin: Origin; recording_id: string }
  recording_trimmed: { recording_id: string }
  link_added: { service: Service; via: LinkVia; link_id: string; tune_id: string }
  link_removed: { service: Service; link_id: string }
  link_opened_externally: { service: Service; link_id: string }
  find_recordings_used: { service: Service; result_count_bucket?: CountBucket }
  playback_ended: {
    source: Source
    queue: Queue
    trigger: Trigger
    kind: Kind
    service?: Service
    listened_bucket?: ListenedBucket
    completed?: boolean
    ended_by: EndedBy
    system_controlled: boolean
    tune_id?: string
    recording_id?: string
    link_id?: string
    list_id?: string
  }
  playlist_started: {
    shuffle: boolean
    repeat: Repeat
    count_bucket: CountBucket
    list_id: string
  }
  practice_ended: {
    source: Source
    duration_bucket: DurationBucket
    used_loops: boolean
    used_speed: boolean
    used_pitch: boolean
    kind: Kind
    recording_id: string
    tune_id?: string
  }
  loop_set: { recording_id: string }
  speed_changed: { speed_bucket: SpeedBucket; recording_id: string }
  pitch_changed: { semitones: number; recording_id: string }
  scan_added: { via: ScanVia; scan_id: string; tune_id: string }
  scan_viewed: { tune_id: string }
  scan_deleted: { scan_id: string; tune_id: string }
  scans_reordered: { tune_id: string }
  setting_changed: SettingChange
  usage_sharing_disabled: Empty
  storage_limit_reached: { storage_used: BytesBucket }
  upload_failed: { failure_reason: FailureReason; origin: Origin }
  sync_failed: { failure_reason: FailureReason }
  export_completed: { format: ExportFormat }
  export_failed: { format: ExportFormat; failure_reason: FailureReason }
  microphone_denied: { source: Source }
}

export type EventName = keyof EventProps

/** The person properties the web sets. `signed_up_at` goes to `identify` on its own. */
export interface PersonProperties {
  catalog_size?: CountBucket
  storage_used?: BytesBucket
  fields_used?: TuneField[]
  setting_instruments?: Instrument[]
  setting_audio_quality?: AudioQuality
  setting_search_providers?: Service[]
  setting_play_first?: PlayFirst
  setting_appearance?: Appearance
  setting_text_size?: number
  setting_download_all?: boolean
  setting_new_tune_status?: TuneStatus
  setting_new_tune_genre_set?: boolean
}
