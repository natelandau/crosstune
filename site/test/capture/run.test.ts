import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOST_RECIPE } from '../../capture/hosts.ts'
import { formatManifest } from '../../capture/manifest.ts'
import { CROP, main, type Media } from '../../capture/run.ts'
import type { Manifest } from '../../capture/types.ts'

const UUID = '0A1B2C3D-0000-4000-8000-000000000000'

const before: Manifest = {
  captures: {
    lists: { kind: 'still', image: 'lists.png', width: 1206, height: 2622, device: 'iphone' },
    tunes: {
      kind: 'clip',
      video: 'tunes.mp4',
      poster: 'tunes.png',
      width: 720,
      height: 1566,
      duration: 9,
      device: 'iphone',
    },
  },
}

let root: string
let output: string
let from: string

// The whole assets folder, file by file, so a test can tell whether a run changed anything.
const snapshot = () =>
  Object.fromEntries(
    readdirSync(output)
      .sort()
      .map((file) => [file, readFileSync(join(output, file), 'utf8')]),
  )

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'crosstune-run-test-'))
  output = join(root, 'assets')
  from = join(root, 'capture', 'attachments')
  mkdirSync(output, { recursive: true })
  mkdirSync(from, { recursive: true })
  writeFileSync(join(output, 'captures.json'), formatManifest(before))
  for (const file of ['tunes.mp4', 'tunes.png', 'lists.png']) {
    writeFileSync(join(output, file), `old ${file}`)
  }
  // An export holding one clip: its timeline and screen recording.
  writeFileSync(
    join(from, 'timeline.json'),
    JSON.stringify({
      name: 'tunes',
      scale: 3,
      start: 100,
      end: 108,
      taps: [{ t: 102, x: 1, y: 1 }],
    }),
  )
  writeFileSync(join(from, 'recording.mp4'), 'raw')
  writeFileSync(
    join(from, 'manifest.json'),
    JSON.stringify([
      {
        testIdentifier: 'FeatureCaptures/test_tunes()',
        attachments: [
          {
            exportedFileName: 'timeline.json',
            suggestedHumanReadableName: `tunes.timeline_0_${UUID}.json`,
            timestamp: 100,
          },
          {
            exportedFileName: 'recording.mp4',
            suggestedHumanReadableName: 'Screen Recording',
            timestamp: 99,
          },
        ],
      },
    ]),
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const media = (encode: Media['encodeClip']): Media => ({
  encodeClip: encode,
  videoDuration: async () => 10,
  copyStill: async (_source, destination) => {
    writeFileSync(destination, 'still')
    return { width: 1, height: 1 }
  },
})

describe('main', () => {
  it('leaves every asset and the manifest untouched when an encode fails', async () => {
    const was = snapshot()
    const failing = media(async () => {
      throw new Error('ffmpeg exited 1')
    })

    await expect(main(['--from', from, 'tunes'], { output, media: failing })).rejects.toThrow(
      'ffmpeg exited 1',
    )
    expect(snapshot()).toEqual(was)
  })

  it('replaces only the named capture and leaves no temporary files', async () => {
    const encoding = media(async (job) => {
      writeFileSync(job.video, 'new video')
      writeFileSync(job.poster, 'new poster')
      return { width: 720, height: 1566, duration: 8.5, bytes: 9, crf: 28 }
    })

    await main(['--from', from, 'tunes'], { output, media: encoding })

    const after = snapshot()
    expect(after['tunes.mp4']).toBe('new video')
    expect(after['tunes.png']).toBe('new poster')
    expect(after['lists.png']).toBe('old lists.png')
    const manifest = JSON.parse(after['captures.json']) as Manifest
    expect(manifest.captures.lists).toEqual(before.captures.lists)
    expect(manifest.captures.tunes).toMatchObject({ kind: 'clip', duration: 8.5 })
    expect(Object.keys(after).filter((file) => file.endsWith('.tmp'))).toEqual([])
  })

  it('leaves out a host still a run skipped even when its file is left over', async () => {
    writeFileSync(join(root, 'capture', 'family-mac.png'), 'stale')
    const encoding = media(async (job) => {
      writeFileSync(job.video, 'new video')
      writeFileSync(job.poster, 'new poster')
      return { width: 720, height: 1566, duration: 8.5, bytes: 9, crf: 28 }
    })

    await main(['--from', from, '--skip', 'family-mac,family-web,family-android'], {
      output,
      media: encoding,
    })

    expect(existsSync(join(output, 'family-mac.png'))).toBe(false)
    const manifest = JSON.parse(snapshot()['captures.json']) as Manifest
    expect(Object.keys(manifest.captures)).not.toContain('family-mac')
    expect(manifest.captures.tunes).toMatchObject({ kind: 'clip', duration: 8.5 })
  })

  it('publishes a left-over host still when the run skips nothing', async () => {
    writeFileSync(join(root, 'capture', 'family-mac.png'), 'fresh')
    const encoding = media(async (job) => {
      writeFileSync(job.video, 'v')
      writeFileSync(job.poster, 'p')
      return { width: 720, height: 1566, duration: 8.5, bytes: 9, crf: 28 }
    })

    await main(['--from', from], { output, media: encoding })

    const manifest = JSON.parse(snapshot()['captures.json']) as Manifest
    expect(Object.keys(manifest.captures)).toContain('family-mac')
  })

  it('names a missing host still and the recipe that makes it', async () => {
    const was = snapshot()

    await expect(
      main(['--from', from, 'family-mac'], { output, media: media(async () => ({}) as never) }),
    ).rejects.toThrow(
      `family-mac: ${join(root, 'capture', 'family-mac.png')} is missing; run \`${HOST_RECIPE['family-mac']}\``,
    )
    expect(snapshot()).toEqual(was)
    expect(existsSync(join(output, 'family-mac.png'))).toBe(false)
  })

  it('drops a capture named by --drop and its files, keeping the rest', async () => {
    await main(['--drop', 'tunes'], { output })

    const after = snapshot()
    const manifest = JSON.parse(after['captures.json']) as Manifest
    expect(Object.keys(manifest.captures)).toEqual(['lists'])
    expect(after['lists.png']).toBe('old lists.png')
    expect(Object.keys(after).sort()).toEqual(['captures.json', 'lists.png'])
  })

  it('drops and publishes in one run', async () => {
    const encoding = media(async (job) => {
      writeFileSync(job.video, 'new video')
      writeFileSync(job.poster, 'new poster')
      return { width: 720, height: 1566, duration: 8.5, bytes: 9, crf: 28 }
    })
    writeFileSync(
      join(from, 'manifest.json'),
      readFileSync(join(from, 'manifest.json'), 'utf8').replaceAll('tunes', 'tune'),
    )

    await main(['--from', from, '--drop', 'lists,tunes', 'tune'], { output, media: encoding })

    const after = snapshot()
    const manifest = JSON.parse(after['captures.json']) as Manifest
    expect(Object.keys(manifest.captures)).toEqual(['tune'])
    expect(Object.keys(after).sort()).toEqual(['captures.json', 'tune.mp4', 'tune.png'])
  })

  it('refuses a name given both to --drop and to publish, before encoding', async () => {
    const was = snapshot()
    let encoded = false
    const encoding = media(async () => {
      encoded = true
      return { width: 720, height: 1566, duration: 8, bytes: 9, crf: 28 }
    })

    await expect(
      main(['--from', from, '--drop', 'tunes', 'tunes'], { output, media: encoding }),
    ).rejects.toThrow('tunes is both published and dropped')
    expect(encoded).toBe(false)
    expect(snapshot()).toEqual(was)
  })

  it('names a --drop capture the manifest does not hold, before encoding', async () => {
    const was = snapshot()
    let encoded = false
    const encoding = media(async () => {
      encoded = true
      return { width: 720, height: 1566, duration: 8, bytes: 9, crf: 28 }
    })

    await expect(main(['--drop', 'tune,lists,practice'], { output })).rejects.toThrow(
      'cannot drop tune, practice: not in captures.json',
    )
    await expect(
      main(['--from', from, '--drop', 'tune', 'tunes'], { output, media: encoding }),
    ).rejects.toThrow('cannot drop tune: not in captures.json')
    expect(encoded).toBe(false)
    expect(snapshot()).toEqual(was)
  })

  it('keeps a zoomed capture whole and hands its crop to the encoder', async () => {
    writeFileSync(
      join(from, 'manifest.json'),
      readFileSync(join(from, 'manifest.json'), 'utf8').replaceAll('tunes', 'tunes-status'),
    )
    const jobs: Parameters<Media['encodeClip']>[0][] = []
    const encoding = media(async (job) => {
      jobs.push(job)
      writeFileSync(job.video, 'v')
      writeFileSync(job.poster, 'p')
      return { width: 720, height: 1566, duration: 8, bytes: 9, crf: 28 }
    })

    await main(['--from', from, 'tunes-status'], { output, media: encoding })

    expect(jobs).toHaveLength(1)
    expect(jobs[0].windows).toEqual([{ ss: 1, to: 9 }])
    expect(jobs[0].crop).toEqual(CROP['tunes-status'])
  })
})

describe('CROP', () => {
  it('zooms every capture between 1.2 and 1.6', () => {
    for (const [name, crop] of Object.entries(CROP)) {
      expect(crop.zoom, name).toBeGreaterThanOrEqual(1.2)
      expect(crop.zoom, name).toBeLessThanOrEqual(1.6)
    }
  })
})
