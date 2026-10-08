import type { Mode } from '../../api/vocabulary'
import { INSTRUMENT_LABELS, STATUS_LABELS } from '../../constants'
import { isInstrument } from '../../db/types'
import { formatRecorded } from './formatRecorded'
import type { Day, OnThisDay, Rarity } from './types'

// Every word the stats page and the Settings summary row show.

export const STATS_TITLE = 'Stats'

export const COUNTS_HEADER = 'Catalog'
export const RECORDED_HEADER = 'Recorded'
export const MONTHS_HEADER = 'Over time'
export const ACTIVITY_HEADER = 'Activity'
export const ON_THIS_DAY_HEADER = 'On this day'
export const RARITIES_HEADER = 'Rarities'

export const TUNES_LABEL = 'Tunes'
export const LISTS_LABEL = 'Lists'
export const RECORDINGS_LABEL = 'Recordings'
export const LINKS_LABEL = 'Links'
export const LEARNING_LABEL = STATUS_LABELS.learning

export const TUNES_ADDED_LABEL = 'Tunes added'
/** The toggle that widens the month bars from the last 12 months to every month. */
export const ALL_TIME = 'All time'
export const ACTIVITY_HINT = 'Tap a day to see what happened.'
/** Names the key grid's table for assistive technology. */
export const KEY_GRID_CAPTION = 'Tunes by key and mode'

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

const countTunes = (n: number) => count(n, 'tune', 'tunes')
const countRecordings = (n: number) => count(n, 'recording', 'recordings')
const countScans = (n: number) => count(n, 'scan', 'scans')

/** What separates the parts of a stats line. */
export const SUMMARY_SEPARATOR = ' · '

/**
 * The Settings row that opens the stats page, part by part, so a wrapping line can keep each
 * part whole. Scans appear only when there are any.
 */
export function summaryParts({
  tunes,
  lists,
  recordings,
  scans,
  ms,
}: {
  tunes: number
  lists: number
  recordings: number
  scans: number
  ms: number
}): string[] {
  return [
    countTunes(tunes),
    count(lists, 'list', 'lists'),
    countRecordings(recordings),
    scans > 0 ? countScans(scans) : null,
    formatRecorded(ms),
  ].filter((part) => part !== null)
}

/** The Settings row that opens the stats page, in one line. */
export function summaryLine(counts: Parameters<typeof summaryParts>[0]): string {
  return summaryParts(counts).join(SUMMARY_SEPARATOR)
}

/** The recorded total: `37 recordings · 9 h 12 m`. */
export function recordedLine(recordings: number, ms: number): string {
  return `${countRecordings(recordings)} · ${formatRecorded(ms)}`
}

/** The quiet line under the counts, shown only when some tunes are archived. */
export function archivedLine(n: number): string {
  return `${count(n, 'archived tune', 'archived tunes')}, not counted above`
}

/** The counts block's scans line, shown only when there are any: `86 scans across 41 tunes`. */
export function scansLine(scans: number, tunes: number): string {
  return `${countScans(scans)} across ${countTunes(tunes)}`
}

/** The counts block's tally of lists and links, then scans once there are any. */
export function tallyLine({
  lists,
  links,
  scans,
  scan_tunes,
}: {
  lists: number
  links: number
  scans: number
  scan_tunes: number
}): string {
  return [
    `${LISTS_LABEL} ${lists.toLocaleString('en-US')}`,
    `${LINKS_LABEL} ${links.toLocaleString('en-US')}`,
    scans > 0 ? scansLine(scans, scan_tunes) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** A counted value, as assistive technology reads its row: `Irish, 3 tunes`. */
export function valueLabel(value: string, n: number): string {
  return `${value}, ${countTunes(n)}`
}

/** The row that opens a breakdown past its first values: `Show all 12`. */
export function showAllLabel(n: number): string {
  return `Show all ${n.toLocaleString('en-US')}`
}

/** Column headings for the key grid, short enough to sit side by side at phone width. */
export const MODE_COLUMNS: Record<Mode, string> = {
  major: 'Maj',
  minor: 'Min',
  dorian: 'Dor',
  mixolydian: 'Mix',
  modal: 'Modal',
  other: 'Other',
}

/** A key's total in the key grid, as assistive technology reads its control. */
export function keyCellLabel(key: string, n: number): string {
  return `${key}, ${countTunes(n)}`
}

/** One key and mode cell of the key grid. */
export function keyModeCellLabel(key: string, mode: string, n: number): string {
  return `${key} ${mode}, ${countTunes(n)}`
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const DAY_THIS_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const DAY_OTHER_YEAR = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

/**
 * The month label over each heatmap column: the short month at the week holding its 1st, or
 * null. Two 1sts are at least four weeks apart, so no two labels crowd each other.
 */
export function weekMonthLabels(days: readonly { date: string }[]): (string | null)[] {
  const labels: (string | null)[] = []
  for (let column = 0; column * 7 < days.length; column++) {
    const first = days.slice(column * 7, column * 7 + 7).find((day) => day.date.endsWith('-01'))
    labels.push(first ? MONTH_SHORT.format(new Date(`${first.date}T00:00:00Z`)) : null)
  }
  return labels
}

/** `YYYY-MM` as `Oct 2026`. */
export function monthLabel(month: string): string {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`))
}

/** One month's bar, as assistive technology reads it. */
export function monthBarLabel(month: string, n: number): string {
  return `${monthLabel(month)}: ${n.toLocaleString('en-US')}`
}

/**
 * A heatmap day's detail, with only the nonzero parts and the year only when it is not
 * `today`'s: "Mar 14 · 12 plays · 2 practice sessions · 3 scans viewed · 3 tunes added".
 */
export function dayDetail(day: Day, today: string): string {
  const date = new Date(`${day.date}T00:00:00Z`)
  const format = day.date.slice(0, 4) === today.slice(0, 4) ? DAY_THIS_YEAR : DAY_OTHER_YEAR
  const parts = [
    day.plays > 0 ? count(day.plays, 'play', 'plays') : null,
    day.practice_sessions > 0
      ? count(day.practice_sessions, 'practice session', 'practice sessions')
      : null,
    day.scan_views > 0 ? count(day.scan_views, 'scan viewed', 'scans viewed') : null,
    day.recordings > 0 ? countRecordings(day.recordings) : null,
    day.tunes_added > 0 ? count(day.tunes_added, 'tune added', 'tunes added') : null,
    day.status_changes > 0 ? count(day.status_changes, 'status change', 'status changes') : null,
  ].filter((part) => part !== null)
  return [format.format(date), ...parts].join(' · ')
}

function yearsAgo(years: number): string {
  return years === 1 ? 'one year ago' : `${years} years ago`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * One on-this-day line. `title` names the tune, or for a recording line its tune or its own
 * label. Null, when nothing names it, reads as "a tune" or "a recording".
 */
export function onThisDayLine(line: OnThisDay, title: string | null): string {
  const ago = yearsAgo(line.years)
  const name = title ?? 'a tune'
  switch (line.kind) {
    case 'first_tune':
      return `Your first tune, ${name}, ${ago}`
    case 'first_recording':
      return `Your first recording, ${ago}`
    case 'tune_added':
      return `${capitalize(ago)} you added ${name}`
    case 'recording':
      // A recording counts on the day it was added, which may be long after it was played.
      return title === null
        ? `${capitalize(ago)} you added a recording`
        : `${capitalize(ago)} you added a recording of ${title}`
    case 'learned':
      return `You learned ${name} ${ago}`
  }
}

function instrumentWord(instrument: string | undefined): string {
  return instrument && isInstrument(instrument)
    ? INSTRUMENT_LABELS[instrument].toLowerCase()
    : (instrument ?? '')
}

/** One rarity line. The tune it names shows beside it. */
export function rarityLine(rarity: Rarity): string {
  switch (rarity.attribute) {
    case 'key_mode':
      return `Your only tune in ${rarity.value}`
    case 'time_signature':
      return `Your only ${rarity.value} tune`
    case 'tuning':
      return `Your only ${instrumentWord(rarity.instrument)} tune in ${rarity.value}`
    case 'tune_type':
      return `Your only ${rarity.value}`
    case 'genre':
      return `Your only ${rarity.value} tune`
  }
}
