import { expect, test, vi } from 'vitest'
import input from '../../../../../fixtures/export/input.json'
import listsCsv from '../../../../../fixtures/export/lists.csv?raw'
import paths from '../../../../../fixtures/export/paths.txt?raw'
import tunesCsv from '../../../../../fixtures/export/tunes.csv?raw'
import type {
  ListItemRow,
  ListRow,
  ScanRow,
  RecordingLinkRow,
  RecordingRow,
  TuneRow,
  UserTuneRow,
} from '../../../api/types'
import { stripOwnership, type LocalRecording } from '../../../db/types'
import { scanRow, recordingRow, tuneRow, userTuneRow } from '../../../test/rows'
import {
  audioExtension,
  buildExport,
  LISTS_HEADER,
  TUNES_HEADER,
  type ExportInput,
} from './buildExport'
import { csvDocument } from './csv'

interface Fixture {
  time_zone: string
  instruments: string[]
  tunes: TuneRow[]
  user_tunes: UserTuneRow[]
  lists: ListRow[]
  list_items: ListItemRow[]
  recording_links: RecordingLinkRow[]
  recordings: (RecordingRow & Required<Pick<RecordingRow, 'recorded_at' | 'recorded_precision'>>)[]
  scans: ScanRow[]
  local_scans: string[]
  local_files: { recording_id: string; content_type: string | null; extension: string }[]
}

// The JSON holds full wire rows, so the one cast is to the contract's row types.
const fixture = input as unknown as Fixture

function fromFixture(data: Fixture): ExportInput {
  return {
    timeZone: data.time_zone,
    instruments: data.instruments,
    tunes: data.tunes.map(stripOwnership),
    userTunes: data.user_tunes.map(stripOwnership),
    lists: data.lists.map(stripOwnership),
    listItems: data.list_items.map(stripOwnership),
    links: data.recording_links.map(stripOwnership),
    recordings: data.recordings.map(stripOwnership),
    scans: data.scans.map(stripOwnership),
    localScans: new Set(data.local_scans),
    localAudio: data.local_files.map((file) => ({
      recordingId: file.recording_id,
      contentType: file.content_type,
    })),
  }
}

function emptyInput(): ExportInput {
  return {
    timeZone: 'America/New_York',
    instruments: [],
    tunes: [],
    userTunes: [],
    lists: [],
    listItems: [],
    links: [],
    recordings: [],
    localAudio: [],
    scans: [],
    localScans: new Set(),
  }
}

function tuneRows(plan: { tunesCsv: string }): string[][] {
  // Enough parsing for unquoted test rows: drop the BOM and the trailing CRLF.
  return plan.tunesCsv
    .slice(1)
    .split('\r\n')
    .slice(1, -1)
    .map((line) => line.split(','))
}

test('matches the golden fixture byte for byte', () => {
  const plan = buildExport(fromFixture(fixture))
  expect(plan.tunesCsv).toBe(tunesCsv)
  expect(plan.listsCsv).toBe(listsCsv)
  expect([...plan.audio, ...plan.scans].map((a) => a.path).join('\n') + '\n').toBe(paths)
})

test('builds one date formatter per export', () => {
  const formatters = vi.spyOn(Intl, 'DateTimeFormat')
  buildExport(fromFixture(fixture))
  expect(formatters).toHaveBeenCalledOnce()
})

test('maps every fixture content type to the extension Apple reads', () => {
  for (const file of fixture.local_files) {
    expect(audioExtension(file.content_type)).toBe(file.extension)
  }
})

test('an empty account gives headers only and no audio', () => {
  const plan = buildExport(emptyInput())
  expect(plan.tunesCsv).toBe(csvDocument([TUNES_HEADER]))
  expect(plan.listsCsv).toBe(csvDocument([LISTS_HEADER]))
  expect(plan.audio).toEqual([])
  expect(plan.totalRecordings).toBe(0)
})

test('counts a recording without local audio as missing', () => {
  const plan = buildExport(fromFixture(fixture))
  expect(plan.totalRecordings - plan.audio.length).toBe(1)
})

test('pairs each exported path with its recording', () => {
  const plan = buildExport(fromFixture(fixture))
  const id = (n: number) => `00000000-0000-4000-8000-000000000${n}`
  expect(plan.audio.map((a) => [a.recordingId, a.path])).toEqual([
    [id(631), 'recordings/Untitled/2026-09-25.mp3'],
    [id(611), "recordings/Cluck Old Hen/2026-09-14 Jam at Ray's.m4a"],
    [id(612), 'recordings/Cluck Old Hen/2026-09-20.m4a'],
    [id(613), 'recordings/Cluck Old Hen/2026-09-20 (2).m4a'],
    [id(621), 'recordings/cluck old hen (2)/2026-09-21.webm'],
    [id(641), 'recordings/Ríl Mhór/2026-09-26 Slow practice.ogg'],
    [id(642), 'recordings/Ríl Mhór/2026-09-26.m4a'],
    [id(643), 'recordings/Ríl Mhór/2026-09-26 (2).m4a'],
    [id(651), "recordings/Unfiled/2026-09-27 Soldier's Joy take.audio"],
    [id(681), 'recordings/Unfiled/2026-09-29 Sally take.m4a'],
    [id(671), 'recordings/Unfiled/2026-09-30 Unknown reel.m4a'],
    [id(691), 'recordings/Unfiled/2026-10-01.m4a'],
  ])
})

test('names a recording by when it was added, whatever its recorded date', () => {
  const recording = (id: string, patch: Partial<LocalRecording>) =>
    recordingRow(id, { tune_id: null, added_at: '2026-03-05T15:00:00.000Z', ...patch })
  const plan = buildExport({
    ...emptyInput(),
    recordings: [
      recording('a', { recorded_at: '1937-01-01T00:00:00.000Z', recorded_precision: 'year' }),
      recording('b', { recorded_at: null, recorded_precision: null }),
    ],
    localAudio: [
      { recordingId: 'a', contentType: 'audio/mp4' },
      { recordingId: 'b', contentType: 'audio/mp4' },
    ],
  })
  expect(plan.audio.map((a) => a.path)).toEqual([
    'recordings/Unfiled/2026-03-05.m4a',
    'recordings/Unfiled/2026-03-05 (2).m4a',
  ])
})

test('maps known audio types and falls back to audio', () => {
  expect(audioExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
  expect(audioExtension('AUDIO/WAV')).toBe('wav')
  expect(audioExtension('audio/x-wav')).toBe('wav')
  expect(audioExtension('audio/aac')).toBe('aac')
  expect(audioExtension('audio/flac')).toBe('flac')
  expect(audioExtension('application/octet-stream')).toBe('audio')
  expect(audioExtension('')).toBe('audio')
  expect(audioExtension(null)).toBe('audio')
})

test('writes a status or mode this client does not know as stored', () => {
  const plan = buildExport({
    ...emptyInput(),
    tunes: [tuneRow('t1', 'Reel', { modes: ['lydian', 'major'] })],
    userTunes: [userTuneRow('u1', 't1', { status: 'retired' })],
  })
  const [row] = tuneRows(plan)
  expect(row?.[TUNES_HEADER.indexOf('status')]).toBe('retired')
  expect(row?.[TUNES_HEADER.indexOf('modes')]).toBe('A: lydian; B: Major')
})

test('writes every stored tuning when no instruments are set', () => {
  const plan = buildExport({
    ...emptyInput(),
    tunes: [
      tuneRow('t1', 'Reel', {
        tunings: {
          guitar: { tuning: 'DADGAD' },
          violin: { tuning: 'AEAE' },
        },
      }),
    ],
    userTunes: [userTuneRow('u1', 't1')],
  })
  const [row] = tuneRows(plan)
  expect(row?.[TUNES_HEADER.indexOf('tunings')]).toBe('Violin: AEAE; Guitar: DADGAD')
})

test('writes every stored tuning when no instrument set is known', () => {
  const plan = buildExport({
    ...emptyInput(),
    instruments: ['harp', 'hurdy_gurdy'],
    tunes: [tuneRow('t1', 'Reel', { tunings: { guitar: { tuning: 'DADGAD' } } })],
    userTunes: [userTuneRow('u1', 't1')],
  })
  const [row] = tuneRows(plan)
  expect(row?.[TUNES_HEADER.indexOf('tunings')]).toBe('Guitar: DADGAD')
})

test('orders tunes with equal titles and dates by user-tune id', () => {
  const plan = buildExport({
    ...emptyInput(),
    tunes: [tuneRow('t1', 'reel'), tuneRow('t2', 'Reel')],
    userTunes: [userTuneRow('b', 't1'), userTuneRow('B', 't2')],
  })
  expect(tuneRows(plan).map((row) => row[0])).toEqual(['Reel', 'reel'])
})

test('leaves out a user-tune whose tune is deleted or missing', () => {
  const plan = buildExport({
    ...emptyInput(),
    tunes: [tuneRow('t1', 'Gone', { deleted_at: '2026-01-02T00:00:00Z' })],
    userTunes: [userTuneRow('u1', 't1'), userTuneRow('u2', 'missing')],
    recordings: [recordingRow('r1', { tune_id: 't1' })],
    localAudio: [{ recordingId: 'r1', contentType: 'audio/mp4' }],
  })
  expect(plan.tunesCsv).toBe(csvDocument([TUNES_HEADER]))
  expect(plan.audio.map((a) => a.path)).toEqual(['recordings/Unfiled/2026-01-01.m4a'])
})

test('gives a tune titled Unfiled its own folder', () => {
  const plan = buildExport({
    ...emptyInput(),
    tunes: [tuneRow('t1', 'Unfiled')],
    userTunes: [userTuneRow('u1', 't1')],
    recordings: [recordingRow('r1', { tune_id: 't1' }), recordingRow('r2')],
    localAudio: [
      { recordingId: 'r1', contentType: 'audio/mp4' },
      { recordingId: 'r2', contentType: 'audio/mp4' },
    ],
  })
  expect(plan.audio.map((a) => a.path)).toEqual([
    'recordings/Unfiled (2)/2026-01-01.m4a',
    'recordings/Unfiled/2026-01-01.m4a',
  ])
})

test("numbers each tune's live, on-device scans from 1 in reading order", () => {
  const plan = buildExport(fromFixture(fixture))
  const id = (n: number) => `00000000-0000-4000-8000-000000000${n}`
  expect(plan.scans.map((n) => [n.scanId, n.path])).toEqual([
    [id(723), 'scans/Untitled/1.jpg'],
    [id(724), 'scans/Untitled/2.jpg'],
    [id(711), 'scans/Cluck Old Hen/1.jpg'],
    [id(712), 'scans/cluck old hen (2)/1.jpg'],
    [id(702), 'scans/Whiskey Before Breakfast/1.jpg'],
    [id(701), 'scans/Whiskey Before Breakfast/2.jpg'],
  ])
})

test('leaves out scans of a tune that is not exported', () => {
  const input = emptyInput()
  input.tunes = [tuneRow('t1', 'Gone', { deleted_at: '2026-01-02T00:00:00.000Z' })]
  input.userTunes = [userTuneRow('u1', 't1')]
  input.scans = [scanRow('p1', 't1'), scanRow('p2', 'missing')]
  input.localScans = new Set(['p1', 'p2'])
  expect(buildExport(input).scans).toEqual([])
})
