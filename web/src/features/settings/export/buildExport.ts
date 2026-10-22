import { INSTRUMENTS, type Mode } from '../../../api/vocabulary'
import { STATUS_LABELS } from '../../../constants'
import { liveTune } from '../../../db/tunes'
import {
  isInstrument,
  isRecordingPrecision,
  type LocalList,
  type LocalListItem,
  type LocalPlace,
  type LocalScan,
  type LocalRecording,
  type LocalRecordingLink,
  type LocalTune,
  type LocalUserTune,
} from '../../../db/types'
import { tuningDisplay } from '../../../domain/instruments'
import { shownPlaceName } from '../../recordings/place'
import { csvDocument } from './csv'
import { NameAllocator } from './safeName'

/** A recording whose audio the export holds, from this device or fetched for the export. */
export interface ExportAudio {
  recordingId: string
  contentType: string | null
}

export interface ExportInput {
  timeZone: string
  instruments: readonly string[]
  tunes: readonly LocalTune[]
  userTunes: readonly LocalUserTune[]
  lists: readonly LocalList[]
  listItems: readonly LocalListItem[]
  links: readonly LocalRecordingLink[]
  recordings: readonly LocalRecording[]
  audio: readonly ExportAudio[]
  scans: readonly LocalScan[]
  /** Ids of the scans whose image the export holds, from this device or fetched for it. */
  scanIds: ReadonlySet<string>
  /** The saved locations, so a linked recording exports the name it shows. */
  places: readonly LocalPlace[]
}

export interface ExportPlan {
  tunesCsv: string
  listsCsv: string
  /** Every recording not deleted, with or without its audio in the export. */
  recordingsCsv: string
  /** Every exported recording with its archive path, in archive order. */
  audio: readonly { recordingId: string; path: string }[]
  /** Every exported scan with its archive path, in archive order. */
  scans: readonly { scanId: string; path: string }[]
  /** Recordings not deleted, exported or not. */
  totalRecordings: number
}

const MODE_LABELS: Record<Mode, string> = {
  major: 'Major',
  minor: 'Minor',
  mixolydian: 'Mixolydian',
  dorian: 'Dorian',
  modal: 'Modal',
  other: 'Other',
}

export const TUNES_HEADER: readonly string[] = [
  'title',
  'alternate_titles',
  'status',
  'archived_on',
  'key',
  'modes',
  'tune_type',
  'genre',
  'time_signature',
  'part_structure',
  'crooked',
  'composer',
  'tunings',
  'learned_from',
  'learned_on',
  'notes',
  'lyrics',
  'links',
  'recordings',
  'added_on',
]

export const LISTS_HEADER: readonly string[] = ['list', 'position', 'tune']

export const RECORDINGS_HEADER: readonly string[] = [
  'file',
  'tune',
  'name',
  'recorded_on',
  'players',
  'place',
  'latitude',
  'longitude',
  'accuracy_m',
  'notes',
]

const UNFILED = 'Unfiled'

const EXTENSIONS: Readonly<Record<string, string | undefined>> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
}

/** The file extension for an audio MIME type, parameters ignored, or `audio` when unknown. */
export function audioExtension(contentType: string | null): string {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return (Object.hasOwn(EXTENSIONS, base) && EXTENSIONS[base]) || 'audio'
}

/** The display label, or the value as stored when it comes from a newer vocabulary. */
function labelOf(labels: Readonly<Record<string, string | undefined>>, value: string): string {
  return (Object.hasOwn(labels, value) && labels[value]) || value
}

function partLetter(index: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + index)
}

/** Formats each instant as `YYYY-MM-DD`, as a clock in `timeZone` shows it. */
function dateFormatter(timeZone: string): (date: Date) => string {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return (date) => format.format(date)
}

/** `YYYY-MM-DD` for the instant, as a clock in `timeZone` shows it. */
export function formatDate(date: Date, timeZone: string): string {
  return dateFormatter(timeZone)(date)
}

const time = (timestamp: string) => Date.parse(timestamp)

// Plain code-unit order, so every client breaks a tie the same way whatever its locale.
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// The id settles a tie, since each client reads rows back in its own storage order.
const byPosition = <Row extends { id: string; position: number }>(a: Row, b: Row) =>
  a.position - b.position || byCodeUnits(a.id, b.id)

function groupBy<Row, Key>(rows: Iterable<Row>, key: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>()
  for (const row of rows) {
    const k = key(row)
    const group = groups.get(k)
    if (group) group.push(row)
    else groups.set(k, [row])
  }
  return groups
}

interface ExportedTune {
  tune: LocalTune
  userTune: LocalUserTune
}

/** Every user-tune not deleted whose tune is present, in storage order. */
function liveTunes(input: Pick<ExportInput, 'tunes' | 'userTunes'>): ExportedTune[] {
  const tunesById = new Map(input.tunes.map((tune) => [tune.id, tune]))
  return input.userTunes.flatMap((userTune) => {
    const tune = userTune.deleted_at ? null : liveTune(tunesById.get(userTune.tune_id))
    return tune ? [{ tune, userTune }] : []
  })
}

/** What the export holds before any of it is named or ordered. */
export type ExportSelectionInput = Pick<
  ExportInput,
  'tunes' | 'userTunes' | 'recordings' | 'audio' | 'scans' | 'scanIds'
>

/**
 * The recordings and scans an export holds, in no particular order: each live recording whose
 * audio it has, filed or not, and each live scan whose image it has on a tune it exports.
 */
export function selectExportFiles(input: ExportSelectionInput): {
  recordings: LocalRecording[]
  scans: LocalScan[]
} {
  return selectFiles(input, liveTunes(input))
}

function selectFiles(
  input: ExportSelectionInput,
  tunes: readonly ExportedTune[],
): { recordings: LocalRecording[]; scans: LocalScan[] } {
  const withAudio = new Set(input.audio.map((audio) => audio.recordingId))
  const tuneIds = new Set(tunes.map(({ tune }) => tune.id))
  return {
    recordings: input.recordings.filter(
      (recording) => !recording.deleted_at && withAudio.has(recording.id),
    ),
    scans: input.scans.filter(
      (scan) => !scan.deleted_at && input.scanIds.has(scan.id) && tuneIds.has(scan.tune_id),
    ),
  }
}

/** Every user-tune not deleted whose tune is present, in the CSV's order. */
function exportedTunes(input: ExportInput): ExportedTune[] {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  return liveTunes(input).sort(
    (a, b) =>
      collator.compare(a.tune.title, b.tune.title) ||
      time(a.userTune.created_at) - time(b.userTune.created_at) ||
      byCodeUnits(a.userTune.id, b.userTune.id),
  )
}

/** Recordings grouped by the exported tune they are filed under; null holds the rest. */
function groupRecordings(
  recordings: readonly LocalRecording[],
  tunes: readonly ExportedTune[],
): Map<string | null, LocalRecording[]> {
  const filedTuneIds = new Set(tunes.map(({ tune }) => tune.id))
  return groupBy(recordings, (recording) =>
    recording.tune_id && filedTuneIds.has(recording.tune_id) ? recording.tune_id : null,
  )
}

/** A tune's recordings in the order the app shows them. */
const inShownOrder = (recordings: readonly LocalRecording[]) =>
  [...recordings].sort(
    (a, b) =>
      a.position - b.position || time(a.added_at) - time(b.added_at) || byCodeUnits(a.id, b.id),
  )

/**
 * Archive paths for every exported recording: tune folders in tune order, then `Unfiled`.
 * Folder and file names are allocated in that same order, so a collision suffix follows the
 * order the app shows.
 */
function planAudio(
  input: ExportInput,
  tunes: readonly ExportedTune[],
  recordings: readonly LocalRecording[],
  dateOf: (timestamp: string) => string,
): { audio: { recordingId: string; path: string }[]; pathsByTune: Map<string, string[]> } {
  const audioById = new Map(input.audio.map((audio) => [audio.recordingId, audio]))
  const groups = groupRecordings(recordings, tunes)

  const audio: { recordingId: string; path: string }[] = []
  const pathsByTune = new Map<string, string[]>()
  const addFolder = (folder: string, recordings: readonly LocalRecording[]): string[] => {
    const files = new NameAllocator()
    return inShownOrder(recordings).map((recording) => {
      const stem = recording.label
        ? `${dateOf(recording.added_at)} ${recording.label}`
        : dateOf(recording.added_at)
      const ext = audioExtension(audioById.get(recording.id)?.contentType ?? null)
      const path = `recordings/${folder}/${files.take(stem, ext)}`
      audio.push({ recordingId: recording.id, path })
      return path
    })
  }

  const folders = new NameAllocator([UNFILED])
  for (const { tune } of tunes) {
    const recordings = groups.get(tune.id)
    if (recordings && !pathsByTune.has(tune.id)) {
      pathsByTune.set(tune.id, addFolder(folders.take(tune.title), recordings))
    }
  }
  const unfiled = groups.get(null)
  if (unfiled) addFolder(UNFILED, unfiled)
  return { audio, pathsByTune }
}

/** Archive paths for each exported scan: a folder per tune, scans numbered in reading order. */
function planScans(
  tunes: readonly ExportedTune[],
  selected: readonly LocalScan[],
): { scanId: string; path: string }[] {
  const scansByTune = groupBy(selected, (scan) => scan.tune_id)
  const folders = new NameAllocator()
  const scans: { scanId: string; path: string }[] = []
  const seen = new Set<string>()
  for (const { tune } of tunes) {
    const tuneScans = scansByTune.get(tune.id)
    if (!tuneScans || seen.has(tune.id)) continue
    seen.add(tune.id)
    const folder = folders.take(tune.title)
    tuneScans.toSorted(byPosition).forEach((scan, index) => {
      scans.push({ scanId: scan.id, path: `scans/${folder}/${index + 1}.jpg` })
    })
  }
  return scans
}

function tuningsText(tune: LocalTune, instruments: readonly string[]): string {
  const chosen = new Set(instruments.filter(isInstrument))
  return INSTRUMENTS.filter((instrument) => chosen.size === 0 || chosen.has(instrument))
    .flatMap(
      (instrument) => tuningDisplay(instrument, tune.tunings, { withInstrument: true }) ?? [],
    )
    .join('; ')
}

function listRows(input: ExportInput, tunes: readonly ExportedTune[]): string[][] {
  const titles = new Map(tunes.map(({ tune, userTune }) => [userTune.id, tune.title]))
  const itemsByList = groupBy(
    input.listItems.filter((item) => !item.deleted_at && titles.has(item.user_tune_id)),
    (item) => item.list_id,
  )
  return input.lists
    .filter((list) => !list.deleted_at)
    .sort(byPosition)
    .flatMap((list) => {
      const items = [...(itemsByList.get(list.id) ?? [])].sort(byPosition)
      if (items.length === 0) return [[list.name, '', '']]
      return items.map((item, index) => [
        list.name,
        String(index + 1),
        titles.get(item.user_tune_id) ?? '',
      ])
    })
}

/**
 * A number as plain decimal digits, never in exponent form, with no trailing zeros: the
 * shortest digits that read back as the same number, as every client writes them.
 */
export function decimalText(value: number): string {
  const text = String(value)
  const sign = text.startsWith('-') ? '-' : ''
  const [mantissa = '', exponent = '0'] = text.slice(sign.length).split(/e/i)
  const [whole = '', fraction = ''] = mantissa.split('.')
  const digits = whole + fraction
  const point = whole.length + Number(exponent)
  let plain =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`
  if (plain.includes('.')) plain = plain.replace(/0+$/, '').replace(/\.$/, '')
  plain = plain.replace(/^0+(?=\d)/, '')
  return plain === '0' ? plain : sign + plain
}

/** When a recording was played, to the precision known: a year, a month, a day. */
function recordedOn(recording: LocalRecording, dateOf: (timestamp: string) => string): string {
  const { recorded_at: at, recorded_precision: precision } = recording
  if (!at || !isRecordingPrecision(precision)) return ''
  if (precision === 'time') return dateOf(at)
  // A partial date is UTC midnight at the start of its period.
  const utc = new Date(time(at)).toISOString()
  return utc.slice(0, precision === 'year' ? 4 : precision === 'month' ? 7 : 10)
}

/** One row per live recording, in tune order then unfiled, each with its archive path if any. */
function recordingRows(
  input: ExportInput,
  tunes: readonly ExportedTune[],
  audio: readonly { recordingId: string; path: string }[],
  dateOf: (timestamp: string) => string,
): string[][] {
  const pathById = new Map(audio.map((a) => [a.recordingId, a.path]))
  const placesById = new Map(input.places.map((place) => [place.id, place]))
  const groups = groupRecordings(
    input.recordings.filter((recording) => !recording.deleted_at),
    tunes,
  )
  const row = (recording: LocalRecording, tune: string) => [
    pathById.get(recording.id) ?? '',
    tune,
    recording.label ?? '',
    recordedOn(recording, dateOf),
    recording.players ?? '',
    shownPlaceName(recording, placesById) ?? '',
    recording.place_lat == null ? '' : decimalText(recording.place_lat),
    recording.place_lon == null ? '' : decimalText(recording.place_lon),
    recording.place_accuracy_m == null ? '' : String(recording.place_accuracy_m),
    recording.notes ?? '',
  ]
  const rows: string[][] = []
  const seen = new Set<string>()
  for (const { tune } of tunes) {
    const recordings = groups.get(tune.id)
    if (!recordings || seen.has(tune.id)) continue
    seen.add(tune.id)
    rows.push(...inShownOrder(recordings).map((recording) => row(recording, tune.title)))
  }
  rows.push(...inShownOrder(groups.get(null) ?? []).map((recording) => row(recording, '')))
  return rows
}

/** The CSV documents and the archive path of every exported recording and scan. */
export function buildExport(input: ExportInput): ExportPlan {
  const format = dateFormatter(input.timeZone)
  const dateOf = (timestamp: string) => format(new Date(time(timestamp)))

  const tunes = exportedTunes(input)
  const selected = selectFiles(input, tunes)
  const { audio, pathsByTune } = planAudio(input, tunes, selected.recordings, dateOf)
  const scans = planScans(tunes, selected.scans)
  const linksByTune = groupBy(
    input.links.filter((link) => !link.deleted_at),
    (link) => link.tune_id,
  )

  const tuneRows = tunes.map(({ tune, userTune }) => [
    tune.title,
    tune.alternate_titles.join('; '),
    labelOf(STATUS_LABELS, userTune.status),
    userTune.archived_at ? dateOf(userTune.archived_at) : '',
    tune.key ?? '',
    tune.modes.map((mode, i) => `${partLetter(i)}: ${labelOf(MODE_LABELS, mode)}`).join('; '),
    tune.tune_type ?? '',
    tune.genre ?? '',
    tune.time_signature ?? '',
    tune.part_structure ?? '',
    tune.is_crooked ? 'yes' : '',
    tune.composer ?? '',
    tuningsText(tune, input.instruments),
    userTune.learned_from ?? '',
    userTune.learned_on ?? '',
    userTune.notes ?? '',
    tune.lyrics ?? '',
    [...(linksByTune.get(tune.id) ?? [])]
      .sort(byPosition)
      .map((link) => link.url)
      .join('\n'),
    (pathsByTune.get(tune.id) ?? []).join('\n'),
    dateOf(userTune.created_at),
  ])

  return {
    tunesCsv: csvDocument([TUNES_HEADER, ...tuneRows]),
    listsCsv: csvDocument([LISTS_HEADER, ...listRows(input, tunes)]),
    recordingsCsv: csvDocument([RECORDINGS_HEADER, ...recordingRows(input, tunes, audio, dateOf)]),
    audio,
    scans,
    totalRecordings: input.recordings.filter((recording) => !recording.deleted_at).length,
  }
}
