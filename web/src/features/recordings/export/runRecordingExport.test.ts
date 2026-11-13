import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingFile, recordingRow } from '../../../test/rows'
import { downloadBlob } from '../../settings/export/runExport'
import type { RecordingView } from '../useRecordings'
import type { ExportReadiness } from './readiness'
import {
  canShareSelection,
  deliverDownload,
  gatherRecordings,
  shareFiles,
  type ExportItem,
} from './runRecordingExport'

vi.mock('../../settings/export/runExport', { spy: true })

const ZONE = 'UTC'

const audio = (text: string, type = 'audio/mp4') => new Blob([text], { type })

function item(id: string, label: string, readiness: ExportReadiness): ExportItem {
  const view: RecordingView = {
    recording: recordingRow(id, { label, recorded_at: null, recorded_precision: null }),
    file: readiness.kind === 'local' ? recordingFile(id, { blob: readiness.blob }) : undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
  return { view, readiness }
}

const local = (id: string, label: string, blob = audio(id)) =>
  item(id, label, { kind: 'local', blob })
const remote = (id: string, label: string) => item(id, label, { kind: 'fetch' })
const blocked = (id: string, label: string) =>
  item(id, label, { kind: 'blocked', reason: 'capturing' })

const fetchFile = vi.fn(async (id: string) => audio(`fetched ${id}`))

beforeEach(() => {
  fetchFile.mockClear()
  vi.mocked(downloadBlob).mockImplementation(() => {})
})

describe('gatherRecordings', () => {
  it('skips a blocked recording and counts it, fetching nothing', async () => {
    const result = await gatherRecordings([local('r1', 'Jam'), blocked('r2', 'Reel')], {
      fetchFile,
      timeZone: ZONE,
    })
    expect(result.files.map((f) => f.name)).toEqual(['Jam.m4a'])
    expect(result).toMatchObject({ fetched: 0, skipped: 1, failed: [] })
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('fetches a recording this device does not hold and counts it', async () => {
    const result = await gatherRecordings([remote('r1', 'Jam'), local('r2', 'Reel')], {
      fetchFile,
      timeZone: ZONE,
    })
    expect(fetchFile).toHaveBeenCalledExactlyOnceWith('r1', undefined)
    expect(result).toMatchObject({ fetched: 1, skipped: 0 })
    expect(await result.files[0]!.blob.text()).toBe('fetched r1')
  })

  it('names each file by its audio type, in order, with a number on a repeated name', async () => {
    fetchFile.mockResolvedValueOnce(audio('x', 'audio/mpeg'))
    const result = await gatherRecordings(
      [remote('r1', 'Jam'), local('r2', 'Jam'), local('r3', 'Jam')],
      { fetchFile, timeZone: ZONE },
    )
    expect(result.files.map((f) => f.name)).toEqual(['Jam.mp3', 'Jam.m4a', 'Jam (2).m4a'])
  })

  it('leaves out a recording whose fetch fails and goes on with the others', async () => {
    const error = new Error('network')
    fetchFile.mockRejectedValueOnce(error)
    const result = await gatherRecordings(
      [remote('r1', 'Jam'), remote('r2', 'Reel'), local('r3', 'Waltz')],
      { fetchFile, timeZone: ZONE },
    )
    expect(result.files.map((f) => f.name)).toEqual(['Reel.m4a', 'Waltz.m4a'])
    expect(result).toMatchObject({ fetched: 1, skipped: 1, failed: [error] })
  })

  it('reports progress over the recordings it can export', async () => {
    const onProgress = vi.fn()
    await gatherRecordings([local('r1', 'Jam'), blocked('r2', 'Reel'), remote('r3', 'Waltz')], {
      fetchFile,
      timeZone: ZONE,
      onProgress,
    })
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('rejects with the abort reason and fetches nothing more once aborted', async () => {
    const controller = new AbortController()
    const reason = new DOMException('stopped', 'AbortError')
    fetchFile.mockImplementationOnce(async (id: string) => {
      controller.abort(reason)
      return audio(id)
    })
    await expect(
      gatherRecordings([remote('r1', 'Jam'), remote('r2', 'Reel')], {
        fetchFile,
        timeZone: ZONE,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(fetchFile).toHaveBeenCalledOnce()
  })
})

describe('deliverDownload', () => {
  const NOW = new Date('2026-10-02T12:00:00Z')

  it('downloads one file as itself', async () => {
    const blob = audio('one')
    await deliverDownload([{ name: 'Jam.m4a', blob }], NOW, ZONE)
    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, 'Jam.m4a')
  })

  it('downloads several files as one dated zip with each at its root', async () => {
    await deliverDownload(
      [
        { name: 'Jam.m4a', blob: audio('one') },
        { name: 'Reel.mp3', blob: audio('two') },
      ],
      NOW,
      ZONE,
    )
    expect(downloadBlob).toHaveBeenCalledOnce()
    const [zip, name] = vi.mocked(downloadBlob).mock.calls[0]!
    expect(name).toBe('crosstune-recordings-2026-10-02.zip')
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(entries)).toEqual(['Jam.m4a', 'Reel.mp3'])
  })
})

describe('shareFiles', () => {
  it('names every recording held here as an export names it', () => {
    const files = shareFiles([local('r1', 'Jam'), local('r2', 'Jam')], ZONE)
    expect(files?.map((f) => f.name)).toEqual(['Jam.m4a', 'Jam (2).m4a'])
  })

  it.each([
    ['one recording is on the server only', [local('r1', 'Jam'), remote('r2', 'Reel')]],
    ['one recording is blocked', [local('r1', 'Jam'), blocked('r2', 'Reel')]],
    ['nothing is selected', []],
  ])('shares nothing when %s', (_name, items) => {
    expect(shareFiles(items, ZONE)).toBeNull()
  })
})

describe('canShareSelection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false where the browser cannot share files', () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined })
    expect(canShareSelection([local('r1', 'Jam')], ZONE)).toBe(false)
  })

  it('asks the browser whether it can share the files', () => {
    const canShare = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, canShare })
    expect(canShareSelection([local('r1', 'Jam')], ZONE)).toBe(true)
    expect(canShare).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: 'Jam.m4a' })] })
  })

  it('is false when a recording is not held here', () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true })
    expect(canShareSelection([local('r1', 'Jam'), remote('r2', 'Reel')], ZONE)).toBe(false)
  })
})
