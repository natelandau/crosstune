// Turns the simulator's exported capture attachments into site assets:
//   node capture/run.ts --from <attachments dir> [--skip a,b] [--drop a,b] [names…]
//   node capture/run.ts --drop a,b
// --skip names host stills whose step did not run, so a PNG left from an earlier run is not
// republished as if it were current. --drop removes captures' manifest entries and files; it
// needs no --from, and publishes nothing unless names are given.
// Every requested capture is encoded into a temporary folder first; only when all of them
// succeed do the files move into src/assets/captures and captures.json change, so a failed
// or missing capture leaves the previous assets and entries untouched.
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyStill as realCopyStill,
  encodeClip as realEncodeClip,
  videoDuration as realVideoDuration,
} from './encode.ts'
import { HOST_RECIPE, HOST_STILLS, hostStillPath, splitNames } from './hosts.ts'
import { formatManifest, mergeManifest } from './manifest.ts'
import type { Crop } from './crop.ts'
import { keepWindows, remapTaps, TAIL, trimArgs } from './timeline.ts'
import type { CaptureEntry, Device, Manifest, Timeline } from './types.ts'
import { findAttachments } from './xcresult.ts'
import type { Found } from './xcresult.ts'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dot = join(site, 'capture/tap-dot.png')

/** The media steps, which tests replace so a run needs no ffmpeg. */
export type Media = {
  encodeClip: typeof realEncodeClip
  videoDuration: typeof realVideoDuration
  copyStill: typeof realCopyStill
}

export type RunOptions = {
  /** The assets folder holding captures.json; src/assets/captures by default. */
  output?: string
  media?: Media
}

/** Seconds kept after the last tap: hero-home runs on until its new loop wraps once. */
const TAIL_SECONDS: Record<string, number> = { 'hero-home': 5, 'hero-record': 2 }

/** Taps, by index, whose whole stretch a capture keeps: hero-record's take from record to stop. */
const KEEP_SPANS: Record<string, [number, number][]> = {
  'hero-record': [[0, 1]],
}

/** Seconds to shift a capture's tap dots when they show early (negative) or late. */
const DOT_OFFSET: Record<string, number> = {}

/**
 * Captures zoomed onto one control. A cropped capture keeps its whole scene, since the zoom
 * already narrows what the viewer watches. Each crop's edges fall in the gaps between buttons,
 * chips, and icons; a full-width bar, card, or line of text may run off an edge, since no zoom
 * the spec allows fits the screen's whole width.
 */
export const CROP: Record<string, Crop> = {
  'tunes-status': { zoom: 1.4495, x: 0, y: 0.1183 },
  'tunes-filter': { zoom: 1.4495, x: 0, y: 0.1183 },
  'tunes-search': { zoom: 1.4495, x: 0, y: 0.1183 },
  'tune-links': { zoom: 1.2, x: 0.0066, y: 0.0641 },
  'tune-scans': { zoom: 1.283, x: 0, y: 0.1251 },
  'tune-lyrics': { zoom: 1.283, x: 0, y: 0.1251 },
  'tune-learned': { zoom: 1.283, x: 0, y: 0.1251 },
  'practice-speed': { zoom: 1.3195, x: 0, y: 0.2098 },
  'practice-pitch': { zoom: 1.325, x: 0.2455, y: 0.2083 },
  'practice-loops': { zoom: 1.2, x: 0.0249, y: 0.1526 },
}

const hostDevice: Record<string, Device> = {
  'family-mac': 'mac',
  'family-web': 'browser',
  'family-android': 'android',
}

const device = (name: string): Device => (name === 'family-ipad' ? 'ipad' : 'iphone')

function parseArgs(argv: string[]): {
  from: string | undefined
  skip: string[]
  drop: string[]
  names: string[]
} {
  const value = (flag: string) => {
    const at = argv.indexOf(flag)
    if (at === -1) return undefined
    if (!argv[at + 1]) throw new Error(`${flag} needs a value`)
    return { at, value: argv[at + 1] }
  }
  const list = (flag: { value: string } | undefined) =>
    flag ? flag.value.split(',').filter(Boolean) : []
  const from = value('--from')
  const skip = value('--skip')
  const drop = value('--drop')
  const flagged = new Set(
    [from, skip, drop].flatMap((flag) => (flag ? [flag.at, flag.at + 1] : [])),
  )
  const names = argv.filter((_, i) => !flagged.has(i))
  if (!from && !(drop && names.length === 0)) {
    throw new Error('usage: run.ts --from <attachments dir> [--skip a,b] [--drop a,b] [names…]')
  }
  return {
    from: from ? resolve(from.value) : undefined,
    skip: list(skip),
    drop: list(drop),
    names,
  }
}

/** Every capture with a timeline in the export, for a run that names none. */
function allNames(manifestJson: unknown): string[] {
  const names = new Set<string>()
  for (const test of manifestJson as { attachments: { suggestedHumanReadableName: string }[] }[])
    for (const a of test.attachments ?? []) {
      const match = /^(.+)\.timeline_\d+_[0-9A-F-]+\.json$/i.exec(a.suggestedHumanReadableName)
      if (match) names.add(match[1])
    }
  return [...names].sort()
}

/** Publishes the captures `argv` names, or every one in the export when it names none. */
export async function main(argv: string[], options: RunOptions = {}): Promise<void> {
  const output = options.output ?? join(site, 'src/assets/captures')
  const manifestPath = join(output, 'captures.json')
  const { encodeClip, videoDuration, copyStill } = options.media ?? {
    encodeClip: realEncodeClip,
    videoDuration: realVideoDuration,
    copyStill: realCopyStill,
  }
  const { from, skip, drop, names: requested } = parseArgs(argv)
  const old: Manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const unknown = drop.filter((name) => !old.captures[name])
  if (unknown.length > 0) throw new Error(`cannot drop ${unknown.join(', ')}: not in captures.json`)

  const hostSources = new Map<string, string>()
  const found = new Map<string, Found>()
  // A run that only drops has no export to read.
  if (from !== undefined) {
    // Host stills are written by their own recipes; hostStillPath says where each one lands.
    const hostFile = (name: string) => hostStillPath(name, from)
    const hosts =
      requested.length > 0
        ? splitNames(requested).hosts
        : HOST_STILLS.filter((name) => !skip.includes(name) && existsSync(hostFile(name)))
    const absent = hosts.filter((name) => !existsSync(hostFile(name)))
    if (absent.length > 0) {
      throw new Error(
        absent
          .map((name) => `${name}: ${hostFile(name)} is missing; run \`${HOST_RECIPE[name]}\``)
          .join('\n'),
      )
    }
    for (const name of hosts) hostSources.set(name, hostFile(name))
    const wanted = splitNames(requested).simulator
    if (requested.length === 0 || wanted.length > 0) {
      const exported: unknown = JSON.parse(await readFile(join(from, 'manifest.json'), 'utf8'))
      const names = requested.length > 0 ? wanted : allNames(exported)
      const inExport = (file: string | undefined) =>
        file === undefined ? undefined : join(from, file)
      for (const [name, parts] of findAttachments(exported, names)) {
        found.set(name, {
          ...parts,
          timeline: join(from, parts.timeline),
          video: inExport(parts.video),
          still: inExport(parts.still),
        })
      }
    }
  }
  const hosts = [...hostSources.keys()]
  const names = [...found.keys()]
  // mergeManifest drops after it updates, so such a name would lose its entry but keep its files.
  const both = [...hosts, ...names].filter((name) => drop.includes(name))
  if (both.length > 0) throw new Error(`${both.join(', ')} is both published and dropped`)

  const staging = await mkdtemp(join(tmpdir(), 'crosstune-capture-'))
  try {
    const updates: Record<string, CaptureEntry> = {}
    const files: string[] = []
    for (const [name, source] of hostSources) {
      const image = `${name}.png`
      const size = await copyStill(source, join(staging, image))
      updates[name] = { kind: 'still', image, ...size, device: hostDevice[name] }
      files.push(image)
      console.log(`${name}: still ${size.width}x${size.height}`)
    }
    for (const [name, parts] of found) {
      const timeline: Timeline = JSON.parse(await readFile(parts.timeline, 'utf8'))
      if (parts.still) {
        const image = `${name}.png`
        const size = await copyStill(parts.still, join(staging, image))
        updates[name] = { kind: 'still', image, ...size, device: device(name) }
        files.push(image)
        console.log(`${name}: still ${size.width}x${size.height}`)
        continue
      }
      const source = parts.video!
      const recordingStart = parts.recordingStart!
      const recordingDuration = await videoDuration(source)
      const crop = CROP[name]
      const windows = crop
        ? [trimArgs(timeline, recordingStart)]
        : keepWindows(
            timeline,
            recordingStart,
            recordingDuration,
            TAIL_SECONDS[name] ?? TAIL,
            KEEP_SPANS[name],
          )
      const video = `${name}.mp4`
      const poster = `${name}.png`
      const result = await encodeClip({
        source,
        recordingDuration,
        windows,
        taps: remapTaps(timeline.taps, windows, recordingStart, DOT_OFFSET[name] ?? 0),
        scale: timeline.scale,
        dot,
        video: join(staging, video),
        poster: join(staging, poster),
        crop,
      })
      const { width, height, duration } = result
      updates[name] = { kind: 'clip', video, poster, width, height, duration, device: device(name) }
      files.push(video, poster)
      console.log(
        `${name}: clip ${duration}s, ${Math.round(result.bytes / 1024)} KB at crf ${result.crf}, ` +
          `${windows.length} window(s)`,
      )
    }

    // Copied beside the assets under temporary names first, since the staging folder may sit
    // on another volume; only renames, which cannot leave a half-written file, replace them.
    const dropped = drop.flatMap((name) => {
      const entry = old.captures[name]
      return entry.kind === 'clip' ? [entry.video, entry.poster] : [entry.image]
    })
    const targets = [...files.map((file) => join(output, file)), manifestPath]
    try {
      for (const file of files) await copyFile(join(staging, file), `${join(output, file)}.tmp`)
      await writeFile(`${manifestPath}.tmp`, formatManifest(mergeManifest(old, updates, drop)))
    } catch (error) {
      await Promise.all(targets.map((target) => rm(`${target}.tmp`, { force: true })))
      throw error
    }
    for (const target of targets) await rename(`${target}.tmp`, target)
    // Files a published name just rewrote stay; only the leftovers of dropped entries go.
    const kept = new Set(files)
    for (const file of dropped) if (!kept.has(file)) await rm(join(output, file), { force: true })
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
