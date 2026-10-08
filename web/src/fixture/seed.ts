import type { Mode, TuneStatus } from '../api/vocabulary'
import { setInstruments } from '../commands/settings'
import { setStorage } from '../db/meta'
import type { CrosstuneDb } from '../db/schema'
import type {
  LocalList,
  LocalListItem,
  LocalPlayEvent,
  LocalPracticeSession,
  LocalRecording,
  LocalScanView,
  LocalStatusChange,
  LocalTune,
} from '../db/types'
import { encodePeaks, PEAKS_PER_SECOND } from '../features/waveform/peaks'
import {
  linkRow,
  loopRow,
  playEventRow,
  practiceSessionRow,
  recordingFile,
  recordingRow,
  scanFile,
  scanRow,
  scanViewRow,
  tuneRow,
  userTuneRow,
} from '../test/rows'

const AT = '2026-01-01T00:00:00.000Z'

type Entry = [
  title: string,
  key: string | null,
  mode: Mode | null,
  type: string | null,
  genre: string | null,
  status: TuneStatus,
  extra?: Partial<LocalTune> & { archived?: boolean },
]

const CROSS_A = { violin: { tuning: 'Cross A (AEAE)' } }
const CROSS_G = { violin: { tuning: 'Cross G (GDGD)' } }
const CALICO = { violin: { tuning: 'Calico (AEAC#)' } }
const DOUBLE_C = { five_string_banjo: { tuning: 'Double C (gCGCD)', capo: 2 } }
const SAWMILL = { five_string_banjo: { tuning: 'Sawmill (gDGCD)' } }

const OLD_TIME = 'Old-time'
const IRISH = 'Irish'

/** Old-time and Irish repertoire across keys, statuses, types, and tunings. */
const TUNES: Entry[] = [
  ["Soldier's Joy", 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  [
    "Bonaparte's Retreat",
    'D',
    'major',
    'March',
    OLD_TIME,
    'learning',
    { tunings: { violin: { tuning: 'Dead Man (DDAD)' } } },
  ],
  [
    'Cluck Old Hen',
    'A',
    'dorian',
    'Breakdown',
    OLD_TIME,
    'learning',
    { tunings: { ...CROSS_A, ...SAWMILL } },
  ],
  ['The Silver Spear', 'D', 'major', 'Reel', IRISH, 'known'],
  ['Kesh Jig', 'G', 'major', 'Jig', IRISH, 'known'],
  ['Angeline the Baker', 'D', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ['Forked Deer', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  [
    'Old Joe Clark',
    'A',
    'mixolydian',
    'Breakdown',
    OLD_TIME,
    'known',
    { archived: true, tunings: CROSS_A },
  ],
  ['Sally Goodin', 'A', 'major', 'Breakdown', OLD_TIME, 'learning', { tunings: CROSS_A }],
  ['Sail Away Ladies', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Red Haired Boy', 'A', 'mixolydian', 'Breakdown', OLD_TIME, 'known', { tunings: DOUBLE_C }],
  ['Arkansas Traveler', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Billy in the Lowground', 'C', 'major', 'Breakdown', OLD_TIME, 'learning'],
  ['Big Sciota', 'G', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Elk River Blues', 'A', 'major', 'Rag', OLD_TIME, 'want_to_learn', { tunings: CALICO }],
  ['Fortune', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  [
    "Shove the Pig's Foot a Little Further in the Fire",
    'A',
    'major',
    'Breakdown',
    OLD_TIME,
    'want_to_learn',
    { tunings: CROSS_A },
  ],
  ['Wild Horses at Stoney Point', 'G', 'major', 'Breakdown', OLD_TIME, 'learning'],
  [
    'Waynesboro',
    'A',
    'major',
    'Breakdown',
    OLD_TIME,
    'known',
    { tunings: { ...CROSS_A, ...DOUBLE_C } },
  ],
  ['Duck River', 'A', 'mixolydian', 'Breakdown', OLD_TIME, 'want_to_learn', { tunings: CROSS_A }],
  ['Sandy River Belle', 'G', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Chinquapin Hunting', 'G', 'major', 'Breakdown', OLD_TIME, 'learning', { tunings: CROSS_G }],
  ["Johnny Don't Get Drunk", 'A', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Booth Shot Lincoln', 'F', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ['Lost Indian', 'A', 'major', 'Breakdown', OLD_TIME, 'known', { tunings: CROSS_A }],
  [
    'Midnight on the Water',
    'D',
    'major',
    'Waltz',
    OLD_TIME,
    'known',
    { tunings: { violin: { tuning: 'Dead Man (DDAD)' } } },
  ],
  ['Westphalia Waltz', 'G', 'major', 'Waltz', OLD_TIME, 'learning'],
  ['Ashokan Farewell', 'D', 'major', 'Waltz', null, 'known'],
  ["Hangman's Reel", 'A', 'major', 'Reel', OLD_TIME, 'want_to_learn', { tunings: CROSS_A }],
  ['Year of Jubilo', 'D', 'major', 'Breakdown', OLD_TIME, 'known', { archived: true }],
  ["Durang's Hornpipe", 'D', 'major', 'Hornpipe', OLD_TIME, 'known'],
  ['Whiskey Before Breakfast', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Blackberry Blossom', 'G', 'major', 'Breakdown', 'Bluegrass', 'learning'],
  ['Salt Creek', 'A', 'mixolydian', 'Breakdown', 'Bluegrass', 'want_to_learn'],
  ['Bill Cheatham', 'A', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Eighth of January', 'D', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Lady of the Lake', 'G', 'major', 'Breakdown', OLD_TIME, 'learning'],
  ['Tater Patch', 'Bb', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ["Brushy Fork of John's Creek", 'Eb', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ['Last of Callahan', 'F#', 'minor', 'Breakdown', OLD_TIME, 'learning'],
  [
    'Shady Grove',
    'E',
    'dorian',
    'Breakdown',
    OLD_TIME,
    'known',
    {
      lyrics:
        "Shady Grove, my little love\nShady Grove, I know\nShady Grove, my little love\nI'm bound for Shady Grove",
    },
  ],
  ['Cumberland Gap', 'Db', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ['Cold Frosty Morning', 'A', 'dorian', 'Breakdown', OLD_TIME, 'known', { tunings: CROSS_A }],
  ['Sugar in the Gourd', 'G', 'major', 'Breakdown', OLD_TIME, 'known'],
  ['Policeman', 'Cb', 'major', 'Breakdown', OLD_TIME, 'want_to_learn'],
  ['The Swallowtail Jig', 'E', 'dorian', 'Jig', IRISH, 'learning'],
  ['The Butterfly', 'E', 'minor', 'Slip jig', IRISH, 'known'],
  ['Drowsy Maggie', 'E', 'dorian', 'Reel', IRISH, 'known'],
  ['The Maid Behind the Bar', 'D', 'major', 'Reel', IRISH, 'learning'],
  ["Morrison's Jig", 'E', 'dorian', 'Jig', IRISH, 'known'],
  ['The Banshee', 'G', 'major', 'Reel', IRISH, 'want_to_learn'],
  ['Out on the Ocean', 'G', 'major', 'Jig', IRISH, 'learning'],
  ["The Mason's Apron", 'A', 'major', 'Reel', IRISH, 'want_to_learn'],
  ["Tobin's Jig", 'D', 'major', 'Jig', IRISH, 'known'],
  ['The Lark in the Morning', 'D', 'major', 'Jig', IRISH, 'learning'],
  ['Si Bheag, Si Mhor', 'D', 'major', 'Air', IRISH, 'known'],
  ['The Rights of Man', 'E', 'minor', 'Hornpipe', IRISH, 'want_to_learn'],
  ['Merrily Kissed the Quaker', 'G', 'major', 'Slide', IRISH, 'known'],
  ['Britches Full of Stitches', 'A', 'major', 'Polka', IRISH, 'learning'],
  ['Rakish Paddy', 'D', 'mixolydian', 'Reel', IRISH, 'want_to_learn'],
]

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// scripts/kit-shots.mjs deep-links to these two ids by their slugs.
const FIXTURE_TUNE = slug("Soldier's Joy")
const FIXTURE_OTHER_TUNE = slug('Cluck Old Hen')
const FORKED_DEER = slug('Forked Deer')

const LISTS: [string, string[]][] = [
  ['Thursday jam', ["Soldier's Joy", 'Cluck Old Hen', 'Sally Goodin', 'Forked Deer', 'Big Sciota']],
  ['Session sets', ['The Silver Spear', 'Kesh Jig', 'Drowsy Maggie', 'The Butterfly']],
  [
    'Waltzes',
    ['Midnight on the Water', 'Westphalia Waltz', 'Ashokan Farewell', 'Si Bheag, Si Mhor'],
  ],
]

const SOLDIERS_JOY_LYRICS = [
  'Grasshopper sitting on a sweet potato vine',
  'Sweet potato vine, sweet potato vine',
  'Along comes a chicken and says you are mine',
  "Let's all go down to Sally's",
  '',
  "I'm going to get a drink, don't you want to go",
  "I'm going to get a drink, don't you want to go",
  "I'm going to get a drink, don't you want to go",
  "All for the Soldier's Joy",
  '',
  'Fifteen cents for the morphine, twenty-five cents for the beer',
  "Fifteen cents for the morphine, they'll never get me out of here",
  "Let's all go down to Sally's",
].join('\n')

/** A seeded generator (mulberry32), so the history reads the same on every capture. */
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A page of music, staves with note heads, as a JPEG the browser can decode. */
async function sheetBlob(seed: number, paper: string): Promise<Blob> {
  const width = 600
  const height = 800
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  const next = random(seed)
  context.fillStyle = paper
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#2b2a28'
  context.fillStyle = '#2b2a28'
  context.lineWidth = 1.2
  for (let staff = 0; staff < 8; staff++) {
    const top = 90 + staff * 85
    for (let line = 0; line < 5; line++) {
      context.beginPath()
      context.moveTo(40, top + line * 8)
      context.lineTo(width - 40, top + line * 8)
      context.stroke()
    }
    for (let x = 80; x < width - 50; x += 26) {
      const y = top - 4 + Math.floor(next() * 9) * 4
      context.beginPath()
      context.ellipse(x, y, 5, 3.6, -0.4, 0, Math.PI * 2)
      context.fill()
      context.fillRect(x + 4, y - 26, 1.4, 26)
    }
    for (const x of [40, 190, 340, width - 41]) context.fillRect(x, top, 1.4, 32)
  }
  return canvas.convertToBlob({ type: 'image/jpeg' })
}

/** The take this device holds, with loops, so practice opens on it. */
export const FIXTURE_PRACTICE_TAKE = 'rec-joy-2'
const PRACTICE_TAKE_MS = 212_000

/** A silent 8-bit mono WAV, which every browser plays, at a rate low enough to stay small. */
function silentWav(durationMs: number): Blob {
  const rate = 4000
  const samples = Math.round((rate * durationMs) / 1000)
  const header = new DataView(new ArrayBuffer(44))
  const text = (at: number, value: string) =>
    [...value].forEach((char, index) => header.setUint8(at + index, char.charCodeAt(0)))
  text(0, 'RIFF')
  header.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, rate, true)
  header.setUint32(28, rate, true)
  header.setUint16(32, 1, true)
  header.setUint16(34, 8, true)
  text(36, 'data')
  header.setUint32(40, samples, true)
  // 8-bit PCM is unsigned, so 128 is silence.
  return new Blob([header, new Uint8Array(samples).fill(128)], { type: 'audio/wav' })
}

/** Peaks that swell and fall like bowed phrases, so the waveform has a shape to draw. */
function phrasePeaks(durationMs: number): Uint8Array {
  const next = random(11)
  const count = Math.round((durationMs * PEAKS_PER_SECOND) / 1000)
  const values = new Uint8Array(count)
  for (let index = 0; index < count; index++) {
    const phrase = Math.abs(Math.sin((index / PEAKS_PER_SECOND) * 0.9))
    values[index] = Math.round(40 + 170 * phrase * (0.7 + 0.3 * next()))
  }
  return encodePeaks(values)
}

/** The local time `days` before `now`, since the stats group events by local date. */
const daysBefore = (now: Date, days: number, hour = 19) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, 30).toISOString()

/** Own takes filed and unfiled, plus one Slippery Hill import so Recordings shows Filters. */
function recordings(now: Date): LocalRecording[] {
  const take = (id: string, days: number, extra: Partial<LocalRecording>) =>
    recordingRow(id, {
      added_at: daysBefore(now, days),
      recorded_at: daysBefore(now, days),
      ...extra,
    })
  return [
    take('rec-joy-1', 120, {
      tune_id: FIXTURE_TUNE,
      label: 'Lesson with Bruce',
      duration_ms: 154_000,
    }),
    take('rec-joy-2', 40, {
      tune_id: FIXTURE_TUNE,
      label: 'Slow practice',
      duration_ms: 212_000,
      position: 1,
    }),
    take('rec-hen-1', 9, { tune_id: FIXTURE_OTHER_TUNE, duration_ms: 98_000 }),
    take('rec-sally-1', 22, { tune_id: slug('Sally Goodin'), duration_ms: 131_000 }),
    take('rec-deer-import', 300, {
      tune_id: FORKED_DEER,
      label: 'Forked Deer, Henry Reed',
      source: 'import',
      origin: 'slippery_hill',
      origin_url: 'https://www.slippery-hill.com/forked-deer',
      duration_ms: 87_000,
      recorded_at: '1966-01-01T12:00:00.000Z',
      recorded_precision: 'year',
    }),
    take('rec-jam-1', 3, { label: 'Porch jam', duration_ms: 1_284_000 }),
    take('rec-memo-1', 1, { label: 'B part idea', duration_ms: 41_000 }),
  ]
}

/**
 * Plays, practice, scan views, and status changes over the last thirty weeks, so the stats
 * heatmap and months have marks.
 */
function history(now: Date, tuneIds: readonly string[]) {
  const next = random(7)
  const plays: LocalPlayEvent[] = []
  const sessions: LocalPracticeSession[] = []
  const views: LocalScanView[] = []
  const takes = ['rec-joy-1', 'rec-joy-2', 'rec-hen-1', 'rec-deer-import']
  for (let day = 0; day < 210; day++) {
    const at = daysBefore(now, day)
    // Busier on the weekend and in recent weeks, as a musician's practice runs.
    const weekend = [0, 6].includes(new Date(at).getDay())
    if (next() > (weekend ? 0.8 : 0.45) * (day < 60 ? 1 : 0.6)) continue
    const tuneId = tuneIds[Math.floor(next() * tuneIds.length)]!
    const recordingId = takes[Math.floor(next() * takes.length)]!
    plays.push(
      playEventRow(`play-${day}`, {
        created_at: at,
        started_at: at,
        listened_ms: Math.round((1 + next() * 14) * 60_000),
        recording_id: recordingId,
        tune_id: tuneId,
      }),
    )
    if (next() < 0.5) {
      sessions.push(
        practiceSessionRow(`practice-${day}`, {
          created_at: at,
          started_at: at,
          duration_ms: Math.round((5 + next() * 40) * 60_000),
          recording_id: recordingId,
          tune_id: tuneId,
        }),
      )
    }
    if (next() < 0.3) {
      views.push(
        scanViewRow(`view-${day}`, { created_at: at, started_at: at, tune_id: FIXTURE_TUNE }),
      )
    }
  }
  const changes: LocalStatusChange[] = tuneIds.slice(0, 12).map((tuneId, index) => ({
    id: `change-${tuneId}`,
    server_seq: index + 1,
    user_tune_id: `u-${tuneId}`,
    changed_at: daysBefore(now, 3 + index * 11),
    from_status: 'want_to_learn',
    to_status: 'learning',
  }))
  return { plays, sessions, views, changes }
}

/**
 * About 60 tunes, three lists, recordings with one import, scans, lyrics, and a stats history,
 * all as synced rows. Dates count back from `now`, so the stats always have recent marks.
 */
export async function seedFixture(db: CrosstuneDb, now = new Date()): Promise<void> {
  const tunes = TUNES.map(([title, key, mode, type, genre, status, extra = {}], index) => {
    const { archived, ...fields } = extra
    const id = slug(title)
    // About a tune a week over the last year, and the rest a year ago today for On this day.
    const added = daysBefore(now, index < 52 ? index * 7 + (index % 5) : 365, 12)
    return {
      tune: tuneRow(id, title, {
        key,
        modes: mode ? [mode] : [],
        tune_type: type,
        genre,
        ...fields,
      }),
      userTune: userTuneRow(`u-${id}`, id, {
        status,
        archived_at: archived ? AT : null,
        created_at: added,
        updated_at: added,
      }),
    }
  })
  const lists: LocalList[] = LISTS.map(([name], position) => ({
    id: slug(name),
    created_at: AT,
    updated_at: daysBefore(now, position * 6 + 1),
    deleted_at: null,
    server_seq: 0,
    name,
    position,
  }))
  const items: LocalListItem[] = LISTS.flatMap(([name, titles]) =>
    titles.map((title, position) => ({
      id: `${slug(name)}-${slug(title)}`,
      created_at: AT,
      updated_at: AT,
      deleted_at: null,
      server_seq: 0,
      list_id: slug(name),
      user_tune_id: `u-${slug(title)}`,
      position,
    })),
  )
  const events = history(
    now,
    tunes.map((entry) => entry.tune.id),
  )
  await db.transaction(
    'rw',
    [
      db.tunes,
      db.user_tunes,
      db.lists,
      db.list_items,
      db.recordings,
      db.recording_links,
      db.play_events,
      db.practice_sessions,
      db.scan_views,
      db.status_changes,
    ],
    async () => {
      await db.tunes.bulkPut(tunes.map((entry) => entry.tune))
      await db.user_tunes.bulkPut(tunes.map((entry) => entry.userTune))
      await db.lists.bulkPut(lists)
      await db.list_items.bulkPut(items)
      await db.recordings.bulkPut(recordings(now))
      await db.recording_links.bulkPut([
        linkRow('link-joy-1', FIXTURE_TUNE, {
          url: 'https://www.slippery-hill.com/soldiers-joy',
          provider: 'slippery_hill',
          title: "Soldier's Joy, Henry Reed",
        }),
        linkRow('link-hen-1', FIXTURE_OTHER_TUNE, {
          url: 'https://www.youtube.com/watch?v=cluck',
          provider: 'youtube',
          title: 'Cluck Old Hen at Clifftop',
        }),
      ])
      await db.play_events.bulkPut(events.plays)
      await db.practice_sessions.bulkPut(events.sessions)
      await db.scan_views.bulkPut(events.views)
      await db.status_changes.bulkPut(events.changes)
    },
  )
  await db.user_tunes.update(`u-${FIXTURE_TUNE}`, {
    learned_from: 'Bruce Molsky',
    notes: 'Bow the B part in shuffles. Drone the open D under the high part.',
  })
  await db.tunes.update(FIXTURE_TUNE, {
    lyrics: SOLDIERS_JOY_LYRICS,
    time_signature: '2/2',
    part_structure: 'AABB',
    tunings: {
      violin: { tuning: 'Standard (GDAE)' },
      five_string_banjo: { tuning: 'Open G (gDGBD)' },
    },
  })
  try {
    const papers = ['#f4f1e8', '#efeadf', '#f6f3ec']
    for (const [position, paper] of papers.entries()) {
      const id = `scan-joy-${position + 1}`
      await db.scan_files.put(scanFile(id, await sheetBlob(position + 1, paper)))
      await db.scans.put(scanRow(id, FIXTURE_TUNE, { width: 600, height: 800, position }))
    }
  } catch {
    // Playwright's WebKit refuses a Blob in IndexedDB, so that pass shows the tune unscanned.
  }
  await setStorage(db, {
    used_bytes: 412_000_000,
    quota_bytes: 1_000_000_000,
    max_file_bytes: 200_000_000,
  })
  await setInstruments(db, 'user_1', ['violin', 'five_string_banjo'])
  const audio = silentWav(PRACTICE_TAKE_MS)
  try {
    await db.recording_files.put(
      recordingFile(FIXTURE_PRACTICE_TAKE, {
        blob: audio,
        mime: audio.type,
        bytes: audio.size,
        local_duration_ms: PRACTICE_TAKE_MS,
        local_state: 'uploaded',
        peaks: phrasePeaks(PRACTICE_TAKE_MS),
      }),
    )
  } catch {
    // Playwright's WebKit refuses a Blob in IndexedDB, so that pass has no take to practice.
  }
  // One named loop and one unnamed, so renaming the second offers the B part.
  await db.recording_loops.bulkPut([
    loopRow({
      id: 'loop-joy-a',
      recording_id: FIXTURE_PRACTICE_TAKE,
      label: 'A part',
      start_ms: 6_000,
      end_ms: 22_000,
      color: 0,
    }),
    loopRow({
      id: 'loop-joy-b',
      recording_id: FIXTURE_PRACTICE_TAKE,
      start_ms: 24_000,
      end_ms: 40_000,
      color: 1,
    }),
  ])
}
