import { appendTo, breakdowns, compareText, rarities, type Entry } from './breakdowns'
import {
  addDays,
  addMonths,
  daysSinceEpoch,
  isLeapYear,
  localDate,
  monthsBetween,
  weekday,
} from './calendar'
import { EQUIVALENCES } from './equivalences'
import type {
  Counts,
  Day,
  Equivalence,
  Heatmap,
  Level,
  Months,
  OnThisDay,
  Stats,
  StatsInput,
  StatsRecording,
} from './types'

const MIN_VISIBLE_DAYS = 7
const MAX_ON_THIS_DAY = 3
const HEATMAP_WEEKS = 52
// Under a minute recorded, no comparison reads as more than a joke.
const MIN_EQUIVALENCE_MS = 60_000

/** A recording's length between its trim points, or zero before its duration is known. */
export function trimmedLength(recording: StatsRecording): number {
  const end = recording.trim_end_ms ?? recording.duration_ms ?? 0
  return Math.max(0, end - recording.trim_start_ms)
}

/** Every user-tune not deleted, with its tune when that is not deleted either. */
function catalogEntries(input: StatsInput): Entry[] {
  const tuneById = new Map(input.tunes.filter((t) => !t.deleted_at).map((t) => [t.id, t]))
  const entries: Entry[] = []
  for (const userTune of input.user_tunes) {
    const tune = tuneById.get(userTune.tune_id)
    if (tune && !userTune.deleted_at) entries.push({ tune, userTune })
  }
  return entries
}

function counts(input: StatsInput, entries: Entry[], current: Entry[]): Counts {
  const currentTunes = new Set(current.map((entry) => entry.tune.id))
  const scans = input.scans.filter((scan) => !scan.deleted_at && currentTunes.has(scan.tune_id))
  const withStatus = (status: string) =>
    current.filter((entry) => entry.userTune.status === status).length
  return {
    known: withStatus('known'),
    learning: withStatus('learning'),
    want_to_learn: withStatus('want_to_learn'),
    tunes: current.length,
    archived: entries.length - current.length,
    lists: input.lists.filter((row) => !row.deleted_at).length,
    recordings: input.recordings.filter((row) => !row.deleted_at).length,
    links: input.recording_links.filter((row) => !row.deleted_at).length,
    scans: scans.length,
    scan_tunes: new Set(scans.map((scan) => scan.tune_id)).size,
  }
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** The tune with the most recordings that have a length, and its median length. */
function mostRecordedTune(
  current: Entry[],
  recordings: StatsRecording[],
): { tuneId: string; medianMs: number } | null {
  const lengths = new Map<string, number[]>()
  for (const recording of recordings) {
    const length = trimmedLength(recording)
    if (recording.tune_id && length > 0) {
      appendTo(lengths, recording.tune_id, length)
    }
  }
  const ranked = current
    .filter((entry) => lengths.has(entry.tune.id))
    .sort(
      (a, b) =>
        lengths.get(b.tune.id)!.length - lengths.get(a.tune.id)!.length ||
        compareText(a.tune.title, b.tune.title) ||
        compareText(a.tune.id, b.tune.id),
    )
  const top = ranked[0]
  if (!top) return null
  return {
    tuneId: top.tune.id,
    medianMs: median(lengths.get(top.tune.id)!.sort((a, b) => a - b)),
  }
}

/** One comparison per day: the date picks among the entries the total fits. */
function equivalence(
  totalMs: number,
  today: string,
  current: Entry[],
  recordings: StatsRecording[],
): Equivalence | null {
  const tune = mostRecordedTune(current, recordings)
  const candidates = EQUIVALENCES.filter(
    (entry) =>
      totalMs >= entry.min_ms && totalMs <= entry.max_ms && (entry.id !== 'tune' || tune !== null),
  )
  if (candidates.length === 0) return null
  const pick = candidates[daysSinceEpoch(today) % candidates.length]!
  const unitMs = pick.id === 'tune' ? tune!.medianMs : pick.unit_ms!
  const n = Math.max(1, Math.round(totalMs / unitMs))
  return pick.id === 'tune' ? { id: pick.id, n, tune_id: tune!.tuneId } : { id: pick.id, n }
}

function months(today: string, tunesAdded: readonly string[], recorded: readonly string[]): Months {
  const thisMonth = today.slice(0, 7)
  const tally = (dates: readonly string[]) => {
    const byMonth = new Map<string, number>()
    for (const date of dates) {
      const month = date.slice(0, 7)
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1)
    }
    return byMonth
  }
  const tunes = tally(tunesAdded)
  const recordings = tally(recorded)
  const row = (month: string) => ({
    month,
    tunes_added: tunes.get(month) ?? 0,
    recordings: recordings.get(month) ?? 0,
  })
  const last12 = monthsBetween(addMonths(thisMonth, -11), thisMonth).map(row)
  const first = [...tunes.keys(), ...recordings.keys()]
    .filter((month) => month <= thisMonth)
    .sort(compareText)[0]
  return {
    last12,
    all_time: first ? monthsBetween(first, thisMonth).map(row) : [],
    has_all_time: first !== undefined && first < last12[0]!.month,
  }
}

function emptyDay(date: string): Day {
  return {
    date,
    music_ms: 0,
    plays: 0,
    practice_sessions: 0,
    scan_views: 0,
    tunes_added: 0,
    recordings: 0,
    status_changes: 0,
    level: 0,
  }
}

/**
 * Four steps by quartile of the musician's own days with music: `q(p)` is the nearest-rank
 * value, `v[ceil(p * n) - 1]` of the ascending lengths. A day active with no music is level 1.
 */
function assignLevels(days: Day[]): void {
  const lengths = days
    .map((day) => day.music_ms)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b)
  const q = (p: number) => lengths[Math.ceil(p * lengths.length) - 1]!
  for (const day of days) {
    const active =
      day.plays > 0 ||
      day.practice_sessions > 0 ||
      day.scan_views > 0 ||
      day.tunes_added > 0 ||
      day.recordings > 0 ||
      day.status_changes > 0
    let level: Level = 0
    if (day.music_ms > 0) {
      level =
        day.music_ms <= q(0.25) ? 1 : day.music_ms <= q(0.5) ? 2 : day.music_ms <= q(0.75) ? 3 : 4
    } else if (active) {
      level = 1
    }
    day.level = level
  }
}

function heatmap(input: StatsInput, entries: Entry[], recordings: StatsRecording[]): Heatmap {
  const { today, time_zone: zone } = input
  const start = addDays(today, -weekday(today) - HEATMAP_WEEKS * 7)
  const days: Day[] = []
  const byDate = new Map<string, Day>()
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const day = emptyDay(date)
    days.push(day)
    byDate.set(date, day)
  }
  const at = (instant: string) => byDate.get(localDate(instant, zone))
  for (const play of input.play_events) {
    const day = at(play.started_at)
    if (day) {
      day.plays++
      day.music_ms += play.listened_ms
    }
  }
  for (const session of input.practice_sessions) {
    const day = at(session.started_at)
    if (day) {
      day.practice_sessions++
      day.music_ms += session.duration_ms
    }
  }
  for (const view of input.scan_views) {
    const day = at(view.started_at)
    if (day) day.scan_views++
  }
  for (const recording of recordings) {
    const day = at(recording.recorded_at)
    if (day) {
      day.recordings++
      day.music_ms += trimmedLength(recording)
    }
  }
  for (const { userTune } of entries) {
    const day = at(userTune.created_at)
    if (day) day.tunes_added++
  }
  // A user-tune's first row records its creation, already counted as a tune added.
  for (const change of input.status_changes) {
    const day = change.from_status ? at(change.changed_at) : undefined
    if (day) day.status_changes++
  }
  assignLevels(days)
  return {
    visible: days.filter((day) => day.level > 0).length >= MIN_VISIBLE_DAYS,
    start,
    days,
  }
}

function earliest<T extends { id: string }>(
  rows: readonly T[],
  instant: (row: T) => string,
): T | undefined {
  return [...rows].sort(
    (a, b) => Date.parse(instant(a)) - Date.parse(instant(b)) || compareText(a.id, b.id),
  )[0]
}

function onThisDay(input: StatsInput, entries: Entry[], recordings: StatsRecording[]): OnThisDay[] {
  const { today, time_zone: zone } = input
  const year = Number(today.slice(0, 4))
  const monthDay = today.slice(5)
  const yearsAgo = (date: string): number | null => {
    const anchorYear = Number(date.slice(0, 4))
    const anchorMonthDay = date.slice(5, 10)
    const sameDay =
      anchorMonthDay === monthDay ||
      (anchorMonthDay === '02-29' && monthDay === '02-28' && !isLeapYear(year))
    return sameDay && anchorYear < year ? year - anchorYear : null
  }
  const firstTune = earliest(
    entries.map((entry) => entry.userTune),
    (userTune) => userTune.created_at,
  )
  const firstRecording = earliest(recordings, (recording) => recording.recorded_at)
  const lines: OnThisDay[] = []
  const add = (kind: OnThisDay['kind'], id: string, date: string) => {
    const years = yearsAgo(date)
    if (years !== null) lines.push({ kind, id, years })
  }
  for (const { tune, userTune } of entries) {
    add(
      userTune === firstTune ? 'first_tune' : 'tune_added',
      tune.id,
      localDate(userTune.created_at, zone),
    )
    if (userTune.learned_on) add('learned', tune.id, userTune.learned_on)
  }
  for (const recording of recordings) {
    add(
      recording === firstRecording ? 'first_recording' : 'recording',
      recording.id,
      localDate(recording.recorded_at, zone),
    )
  }
  const isFirst = (line: OnThisDay) =>
    line.kind === 'first_tune' || line.kind === 'first_recording' ? 0 : 1
  return lines
    .sort((a, b) => isFirst(a) - isFirst(b) || b.years - a.years || compareText(a.id, b.id))
    .slice(0, MAX_ON_THIS_DAY)
}

/**
 * Everything the stats page shows, from the rows on the device. Pure: the Swift module must
 * return the same for every case in fixtures/stats.
 */
export function computeStats(input: StatsInput): Stats {
  const entries = catalogEntries(input)
  const current = entries.filter((entry) => !entry.userTune.archived_at)
  const recordings = input.recordings.filter((recording) => !recording.deleted_at)
  const totalMs = recordings.reduce((sum, recording) => sum + trimmedLength(recording), 0)
  const zone = input.time_zone
  return {
    counts: counts(input, entries, current),
    recorded: { count: recordings.length, total_ms: totalMs },
    equivalence:
      totalMs < MIN_EQUIVALENCE_MS ? null : equivalence(totalMs, input.today, current, recordings),
    months: months(
      input.today,
      entries.map((entry) => localDate(entry.userTune.created_at, zone)),
      recordings.map((recording) => localDate(recording.recorded_at, zone)),
    ),
    heatmap: heatmap(input, entries, recordings),
    on_this_day: onThisDay(input, entries, recordings),
    breakdowns: breakdowns(current, input.instruments),
    rarities: rarities(current, input.instruments),
  }
}
