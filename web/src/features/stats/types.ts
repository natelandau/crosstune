// Keys are snake_case so the shared fixtures in fixtures/stats read the same in Swift. Each row
// type names only the fields stats reads, so a full local or wire row satisfies it.

export interface StatsTune {
  id: string
  title: string
  key?: string | null
  /** One per part; the first is the tune's mode. */
  modes: readonly string[]
  tune_type?: string | null
  genre?: string | null
  time_signature?: string | null
  composer?: string | null
  tunings?: unknown
  deleted_at?: string | null
}

export interface StatsUserTune {
  id: string
  tune_id: string
  status: string
  learned_from?: string | null
  /** A plain `YYYY-MM-DD`, not an instant. */
  learned_on?: string | null
  archived_at?: string | null
  created_at: string
  deleted_at?: string | null
}

export interface StatsRecording {
  id: string
  tune_id?: string | null
  recorded_at: string
  duration_ms?: number | null
  trim_start_ms: number
  trim_end_ms?: number | null
  deleted_at?: string | null
}

export interface StatsRow {
  id: string
  deleted_at?: string | null
}

export interface StatsScan {
  id: string
  tune_id: string
  deleted_at?: string | null
}

export interface StatsScanView {
  id: string
  started_at: string
}

export interface StatsPlayEvent {
  id: string
  started_at: string
  listened_ms: number
}

export interface StatsPracticeSession {
  id: string
  started_at: string
  duration_ms: number
}

export interface StatsStatusChange {
  id: string
  from_status?: string | null
  changed_at: string
}

export interface StatsInput {
  /** The device's local date, `YYYY-MM-DD`. */
  today: string
  /** An IANA zone; every instant is read as a local date in it. */
  time_zone: string
  /** The instruments the musician plays, in the order their tunings show. */
  instruments: readonly string[]
  tunes: readonly StatsTune[]
  user_tunes: readonly StatsUserTune[]
  recordings: readonly StatsRecording[]
  recording_links: readonly StatsRow[]
  lists: readonly StatsRow[]
  scans: readonly StatsScan[]
  scan_views: readonly StatsScanView[]
  play_events: readonly StatsPlayEvent[]
  practice_sessions: readonly StatsPracticeSession[]
  status_changes: readonly StatsStatusChange[]
}

export interface Counts {
  known: number
  learning: number
  want_to_learn: number
  tunes: number
  archived: number
  lists: number
  recordings: number
  links: number
  /** Live scans on live, non-archived tunes. */
  scans: number
  /** The distinct tunes holding the counted scans. */
  scan_tunes: number
}

export interface Recorded {
  count: number
  total_ms: number
}

export interface Equivalence {
  id: string
  n: number
  tune_id?: string
}

export interface Month {
  /** `YYYY-MM`. */
  month: string
  tunes_added: number
  recordings: number
}

export interface Months {
  last12: Month[]
  all_time: Month[]
  has_all_time: boolean
}

export type Level = 0 | 1 | 2 | 3 | 4

export interface Day {
  /** `YYYY-MM-DD`. */
  date: string
  music_ms: number
  plays: number
  practice_sessions: number
  scan_views: number
  tunes_added: number
  recordings: number
  status_changes: number
  level: Level
}

export interface Heatmap {
  visible: boolean
  /** The Sunday the first column starts on. */
  start: string
  days: Day[]
}

export type OnThisDayKind =
  'first_tune' | 'first_recording' | 'tune_added' | 'recording' | 'learned'

export interface OnThisDay {
  kind: OnThisDayKind
  /** A tune ID for a tune line, a recording ID for a recording line. */
  id: string
  years: number
}

export interface Value {
  value: string
  count: number
}

export interface KeyRow {
  key: string
  count: number
  modes: Value[]
}

export interface Breakdowns {
  key: KeyRow[]
  tune_type: Value[]
  genre: Value[]
  time_signature: Value[]
  composer: Value[]
  learned_from: Value[]
  tunings: { instrument: string; values: Value[] }[]
}

export type RarityAttribute = 'key_mode' | 'time_signature' | 'tuning' | 'tune_type' | 'genre'

export interface Rarity {
  attribute: RarityAttribute
  value: string
  instrument?: string
  tune_id: string
}

export interface Stats {
  counts: Counts
  recorded: Recorded
  equivalence: Equivalence | null
  months: Months
  heatmap: Heatmap
  on_this_day: OnThisDay[]
  breakdowns: Breakdowns
  rarities: Rarity[]
}
