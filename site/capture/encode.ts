import { execFile } from 'node:child_process'
import { copyFile, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { cropRect } from './crop.ts'
import type { Crop } from './crop.ts'
import { tapFilter } from './timeline.ts'
import type { Tap, Window } from './types.ts'

const run = promisify(execFile)

export const OUT_WIDTH = 720
const FPS = 30
export const TARGET_BYTES = 800 * 1024
const CRF_START = 28
const CRF_STEP = 3
export const CRF_MAX = 40

/**
 * The CRF to encode with next, or null once `bytes` fits the size target. Throws when the clip
 * is still over the target at the highest CRF, since a coarser encode would look worse than a
 * shorter capture.
 */
export function nextCrf(bytes: number, crf: number, name: string): number | null {
  if (bytes <= TARGET_BYTES) return null
  if (crf >= CRF_MAX) {
    throw new Error(
      `${name} is ${Math.round(bytes / 1024)} KB at crf ${crf}, over the ` +
        `${TARGET_BYTES / 1024} KB budget; shorten the capture`,
    )
  }
  return Math.min(CRF_MAX, crf + CRF_STEP)
}

/** Width and height from a PNG's IHDR chunk. */
export async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const header = await readFile(path)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

async function probe(path: string, entries: string): Promise<string[]> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    entries,
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ])
  return stdout.trim().split('\n')
}

/** A recording's duration in seconds, which ends at its last changed frame. */
export async function videoDuration(path: string): Promise<number> {
  const [duration] = await probe(path, 'format=duration')
  return Number(duration)
}

export type ClipJob = {
  source: string
  recordingDuration: number
  windows: Window[]
  /** Tap times in the cut clip, in points. */
  taps: Tap[]
  scale: number
  dot: string
  video: string
  poster: string
  /** A zoomed view of the recording, applied before the scale. */
  crop?: Crop
}

/**
 * The graph from the recording to `[v]`, the cut clip: constant frame rate first, since XCTest
 * writes a frame only when the screen changes, then the last frame held for any window that runs
 * past the file's end, then each window trimmed and the windows joined with jump cuts.
 */
function cutFilter(windows: Window[], recordingDuration: number): string {
  const hold = Math.max(0, ...windows.map((w) => w.to - recordingDuration))
  const parts = windows.map((_, i) => `[p${i}]`).join('')
  const trims = windows.map(
    (w, i) =>
      `[p${i}]trim=start=${w.ss.toFixed(3)}:end=${w.to.toFixed(3)},setpts=PTS-STARTPTS[w${i}]`,
  )
  const joined = windows.map((_, i) => `[w${i}]`).join('')
  return [
    `[0:v]fps=${FPS},tpad=stop_mode=clone:stop_duration=${(hold + 1).toFixed(3)},split=${windows.length}${parts}`,
    ...trims,
    `${joined}concat=n=${windows.length}:v=1:a=0[v]`,
  ].join(';')
}

/**
 * Encodes the kept windows as a silent H.264 clip with tap dots, raising the CRF until it fits
 * the size target, and writes a poster from its first frame. Throws when no CRF fits.
 */
export async function encodeClip(
  job: ClipJob,
): Promise<{ width: number; height: number; duration: number; bytes: number; crf: number }> {
  const [sourceWidth, sourceHeight] = (await probe(job.source, 'stream=width,height')).map(Number)
  const dots = tapFilter(
    { name: '', scale: job.scale, start: 0, end: 0, taps: job.taps },
    sourceWidth,
    OUT_WIDTH,
    job.crop && cropRect(job.crop, sourceWidth, sourceHeight),
  )
  const graph = `${cutFilter(job.windows, job.recordingDuration)};${dots}`
  let crf = CRF_START
  for (;;) {
    await run('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-y', '-i', job.source, '-i', job.dot],
      ...['-filter_complex', graph, '-map', '[out]', '-an', '-r', String(FPS)],
      ...['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p'],
      ...['-movflags', '+faststart', '-map_metadata', '-1', job.video],
    ])
    const next = nextCrf((await stat(job.video)).size, crf, basename(job.video))
    if (next === null) break
    crf = next
  }
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', job.video],
    ...['-frames:v', '1', job.poster],
  ])
  const [width, height] = (await probe(job.video, 'stream=width,height')).map(Number)
  const duration = Number((await videoDuration(job.video)).toFixed(2))
  return { width, height, duration, bytes: (await stat(job.video)).size, crf }
}

/** Copies a still as-is and reports its size. */
export async function copyStill(
  source: string,
  destination: string,
): Promise<{ width: number; height: number }> {
  await copyFile(source, destination)
  return pngSize(destination)
}
