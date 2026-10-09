import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bytesBucket, countBucket, durationBucket, listenedBucket, speedBucket } from './buckets'
import {
  ENUMS,
  SCREENS,
  SETTING_NAMES,
  type EventName,
  type EventProps,
  type PersonProperties,
  type SettingChange,
} from './events'
import { webSuperProperties } from './superProperties'

interface PropSpec {
  type: string
  enum?: string
  bucket?: string
  format?: string
  required?: boolean
}
interface Plan {
  buckets: Record<string, string[]>
  enums: Record<string, string[]>
  super_properties: Record<string, PropSpec & { clients: string[] }>
  person_properties: Record<string, PropSpec & { clients: string[] }>
  settings: Record<string, PropSpec>
  events: Record<
    string,
    { clients: string[]; builtin?: boolean; properties: Record<string, PropSpec> }
  >
}

const plan = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../analytics/tracking-plan.json'), 'utf8'),
) as Plan

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const VERSION = /^\d+\.\d+\.\d+/

const ID_1 = '3f0c1b52-8a7e-4d3a-9c11-2b6f5e0a7d44'
const ID_2 = '9b1d6f3e-52c4-4a07-8e2d-71a4c0b3f598'

function allowedValues(spec: PropSpec): string[] | null {
  if (spec.enum) return plan.enums[spec.enum] ?? []
  if (spec.bucket) return plan.buckets[spec.bucket] ?? []
  return null
}

function allows(spec: PropSpec, value: unknown): boolean {
  const values = allowedValues(spec)
  switch (spec.type) {
    case 'string':
      if (values) return typeof value === 'string' && values.includes(value)
      if (spec.format === 'version') return typeof value === 'string' && VERSION.test(value)
      if (spec.format === 'iso8601') return typeof value === 'string' && ISO8601.test(value)
      return typeof value === 'string'
    case 'bool':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number'
    case 'uuid':
      return typeof value === 'string' && UUID.test(value)
    case 'string_list':
      return (
        Array.isArray(value) &&
        value.every((v) => typeof v === 'string' && (values ? values.includes(v) : true))
      )
    default:
      return false
  }
}

// A missing key fails the type check, so a new event cannot ship without a sample here.
const SAMPLES: { [N in EventName]: EventProps[N] } = {
  signed_in: {},
  signed_out: {},
  account_deleted: {},
  account_deletion_started: {},
  account_deletion_cancelled: {},
  tune_created: { source: 'catalog', fields_set: ['title', 'key'], tune_id: ID_1 },
  tune_edited: { fields_changed: ['notes'], tune_id: ID_1 },
  tune_status_changed: { from: 'learning', to: 'known', tune_id: ID_1 },
  tune_archived: { tune_id: ID_1 },
  tune_unarchived: { tune_id: ID_1 },
  tune_deleted: {
    recordings_count: '1-9',
    links_count: '0',
    scans_count: '10-49',
    tune_id: ID_1,
  },
  bulk_edit_applied: { count_bucket: '10-49', action: 'edit', fields_changed: ['genre'] },
  search_performed: { result_count_bucket: '50-199', took_offer: false },
  catalog_filtered: { filter: 'tuning' },
  catalog_sorted: { sort: 'played' },
  lyrics_opened: { tune_id: ID_1 },
  list_created: { list_id: ID_1, count_bucket: '0' },
  list_renamed: { list_id: ID_1 },
  list_deleted: { list_id: ID_1, count_bucket: '1-9' },
  list_reordered: { list_id: ID_1 },
  tunes_added_to_list: { list_id: ID_1, count_bucket: '200+' },
  tunes_removed_from_list: { list_id: ID_1, count_bucket: '1-9' },
  import_started: { entry: 'settings' },
  import_reviewed: {
    reader: 'plain',
    count_bucket: '10-49',
    duplicate_bucket: '1-9',
    has_warnings: true,
  },
  import_completed: { reader: 'plain', count_bucket: '10-49', skipped_bucket: '0', list: 'new' },
  recording_started: { source: 'dock' },
  recording_saved: {
    duration_bucket: '2-5m',
    filed: true,
    recording_id: ID_2,
    tune_id: ID_1,
  },
  recording_discarded: { duration_bucket: '<30s' },
  audio_imported: { count_bucket: '1-9', format: 'm4a' },
  archive_recording_saved: {
    source_archive: 'slippery_hill',
    recording_id: ID_2,
    tune_id: ID_1,
  },
  recording_filed: { from: 'unfiled', origin: 'recorded', recording_id: ID_2, tune_id: ID_1 },
  recording_unfiled: { origin: 'imported', recording_id: ID_2 },
  recording_renamed: { origin: 'recorded', recording_id: ID_2 },
  recording_deleted: { origin: 'slippery_hill', recording_id: ID_2 },
  recording_trimmed: { recording_id: ID_2 },
  link_added: { service: 'youtube', via: 'paste', link_id: ID_2, tune_id: ID_1 },
  link_removed: { service: 'spotify', link_id: ID_2 },
  link_opened_externally: { service: 'bandcamp', link_id: ID_2 },
  find_recordings_used: { service: 'internet_archive', result_count_bucket: '0' },
  playback_ended: {
    source: 'list',
    queue: 'playlist',
    trigger: 'auto_advance',
    kind: 'recorded',
    service: 'other',
    listened_bucket: '30s-2m',
    completed: true,
    ended_by: 'finished',
    system_controlled: false,
    tune_id: ID_1,
    recording_id: ID_2,
    link_id: ID_2,
    list_id: ID_1,
  },
  playlist_started: { shuffle: true, repeat: 'tune', count_bucket: '10-49', list_id: ID_1 },
  practice_ended: {
    source: 'dock',
    duration_bucket: '5m+',
    used_loops: true,
    used_speed: false,
    used_pitch: false,
    kind: 'imported',
    recording_id: ID_2,
    tune_id: ID_1,
  },
  loop_set: { recording_id: ID_2 },
  speed_changed: { speed_bucket: '0.75-0.99', recording_id: ID_2 },
  pitch_changed: { semitones: -2, recording_id: ID_2 },
  scan_added: { via: 'file', scan_id: ID_2, tune_id: ID_1 },
  scan_viewed: { tune_id: ID_1 },
  scan_deleted: { scan_id: ID_2, tune_id: ID_1 },
  scans_reordered: { tune_id: ID_1 },
  setting_changed: { setting: 'appearance', value: 'dark' },
  usage_sharing_disabled: {},
  storage_limit_reached: { storage_used: '500MB+' },
  upload_failed: { failure_reason: 'storage_full', origin: 'recorded' },
  sync_failed: { failure_reason: 'server_error' },
  export_completed: { format: 'zip' },
  export_failed: { format: 'zip', failure_reason: 'network' },
  microphone_denied: { source: 'tune' },
}

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T]
type OptionalProp = {
  [N in EventName]: `${N}.${OptionalKeys<EventProps[N]> & string}`
}[EventName]

// Exactly the optional properties of the event types: one missing or one the type requires fails
// the type check.
const OPTIONAL_PROPS = {
  'bulk_edit_applied.fields_changed': true,
  'recording_saved.tune_id': true,
  'find_recordings_used.result_count_bucket': true,
  'playback_ended.service': true,
  'playback_ended.listened_bucket': true,
  'playback_ended.completed': true,
  'playback_ended.tune_id': true,
  'playback_ended.recording_id': true,
  'playback_ended.link_id': true,
  'playback_ended.list_id': true,
  'practice_ended.tune_id': true,
} satisfies Record<OptionalProp, true>

const SETTING_SAMPLES: SettingChange[] = [
  { setting: 'instruments', value: ['violin', 'guitar'] },
  { setting: 'audio_quality', value: 'high' },
  { setting: 'search_providers', value: ['youtube', 'slippery_hill'] },
  { setting: 'play_first', value: 'recordings' },
  { setting: 'appearance', value: 'system' },
  { setting: 'text_size', value: -1 },
  { setting: 'download_all', value: false },
  { setting: 'new_tune_status', value: 'learning' },
  { setting: 'new_tune_genre_set', value: true },
]

const FULL_PERSON: Required<PersonProperties> = {
  catalog_size: '10-49',
  storage_used: '<10MB',
  fields_used: ['title', 'key'],
  setting_instruments: ['violin'],
  setting_audio_quality: 'standard',
  setting_search_providers: ['youtube'],
  setting_play_first: 'recordings',
  setting_appearance: 'light',
  setting_text_size: 0,
  setting_download_all: true,
  setting_new_tune_status: 'known',
  setting_new_tune_genre_set: false,
}

const webOnly = <T extends { clients: string[] }>(record: Record<string, T>) =>
  Object.entries(record).filter(([, spec]) => spec.clients.includes('web'))

function settingSpec(setting: string): PropSpec {
  const spec = plan.settings[setting]
  if (!spec) throw new Error(`no plan setting ${setting}`)
  return spec
}

describe('tracking plan', () => {
  it("the plan's web events equal the client's events", () => {
    const listed = Object.entries(plan.events)
      .filter(
        ([name, event]) => !event.builtin && name !== '$screen' && event.clients.includes('web'),
      )
      .map(([name]) => name)
      .sort()
    expect(Object.keys(SAMPLES).sort()).toEqual(listed)
  })

  it('every sample matches the plan', () => {
    for (const [name, props] of Object.entries(SAMPLES)) {
      const specs = plan.events[name]!.properties
      expect(Object.keys(props).sort(), name).toEqual(Object.keys(specs).sort())
      for (const [key, value] of Object.entries(props)) {
        const spec = specs[key]
        expect(spec, `${name}.${key}`).toBeDefined()
        if (spec!.type === 'setting_value') {
          const change = props as SettingChange
          expect(allows(settingSpec(change.setting), value), `${name}.${key}`).toBe(true)
        } else {
          expect(allows(spec!, value), `${name}.${key}`).toBe(true)
        }
      }
      for (const [key, spec] of Object.entries(specs)) {
        if (spec.required) expect(props, `${name}.${key}`).toHaveProperty(key)
      }
    }
  })

  it("the types make optional exactly the plan's optional properties", () => {
    const planOptional = Object.entries(SAMPLES).flatMap(([name]) =>
      Object.entries(plan.events[name]!.properties)
        .filter(([, spec]) => !spec.required)
        .map(([key]) => `${name}.${key}`),
    )
    expect(Object.keys(OPTIONAL_PROPS).sort()).toEqual(planOptional.sort())
  })

  it('a sample of every web setting matches the plan', () => {
    expect(SETTING_SAMPLES.map((s) => s.setting).sort()).toEqual([...SETTING_NAMES].sort())
    for (const change of SETTING_SAMPLES) {
      expect(allows(settingSpec(change.setting), change.value), change.setting).toBe(true)
    }
  })

  it('each enum equals its plan enum', () => {
    for (const [name, values] of Object.entries(ENUMS)) {
      expect([...values], name).toEqual(plan.enums[name])
    }
  })

  it('every bucket function covers exactly the plan bucket', () => {
    const outputs = (fn: (n: number) => string, probes: number[]) => [...new Set(probes.map(fn))]
    const cases: [string, (n: number) => string, number[]][] = [
      ['count', countBucket, [0, 1, 10, 50, 200]],
      ['duration', durationBucket, [0, 30_000, 120_000, 300_000]],
      ['listened', listenedBucket, [0, 10_000, 30_000, 120_000, 300_000]],
      ['bytes', bytesBucket, [0, 1, 10_000_000, 50_000_000, 500_000_000]],
      ['speed', speedBucket, [0.5, 0.8, 1, 1.5]],
    ]
    for (const [name, fn, probes] of cases) {
      expect(outputs(fn, probes), name).toEqual(plan.buckets[name])
    }
  })

  it("the screens equal the plan's screen enum minus stand", () => {
    expect([...SCREENS]).toEqual(plan.enums.screen!.filter((s) => s !== 'stand'))
  })

  it("every web setting is in the plan, and the plan's other settings are Apple-only", () => {
    for (const name of SETTING_NAMES) expect(plan.settings).toHaveProperty(name)
    const missing = Object.keys(plan.settings).filter(
      (name) => !(SETTING_NAMES as readonly string[]).includes(name),
    )
    expect(missing).toEqual(['capture_channels'])
  })

  it("the super properties equal the plan's web set", () => {
    const props = webSuperProperties({ coarsePointer: false, shortSide: 900, standalone: false })
    const listed = webOnly(plan.super_properties)
    expect(Object.keys(props).sort()).toEqual(listed.map(([name]) => name).sort())
    for (const [name, spec] of listed) {
      expect(allows(spec, props[name as keyof typeof props]), name).toBe(true)
    }
  })

  it("a full identify equals the plan's web person properties", () => {
    const person = { ...FULL_PERSON, signed_up_at: '2026-10-08T20:21:51Z' }
    const listed = webOnly(plan.person_properties)
    expect(Object.keys(person).sort()).toEqual(listed.map(([name]) => name).sort())
    for (const [name, spec] of listed) {
      expect(allows(spec, person[name as keyof typeof person]), name).toBe(true)
    }
  })
})
