import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../../usage/testing'
import type { CrosstuneDb } from '../../../db/schema'
import { openTestDb } from '../../../test/db'
import { dataProviders, fakeEngine } from '../../../test/providers'
import { recordingRow } from '../../../test/rows'
import type { SyncEngine } from '../../../sync/types'
import { EXPORT_COMPLETE_NOTE, exportNeedsConnection } from './exportCopy'
import { createExport, downloadBlob } from './runExport'
import { useExportData } from './useExportData'

vi.mock('./runExport', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.mocked(downloadBlob).mockImplementation(() => {})
})

const ZIP = { fileName: 'Crosstune export.zip', blob: new Blob(['zip']) }

type Made = Awaited<ReturnType<typeof createExport>>

/** An export that finishes, or fails as an abort does, only when the test says. */
function heldExport() {
  let finish: (made: Made) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  vi.mocked(createExport).mockImplementation(
    () =>
      new Promise<Made>((resolve, reject) => {
        finish = resolve
        fail = reject
      }),
  )
  return { finish: (made: Made) => finish(made), fail: (cause: unknown) => fail(cause) }
}

function setup(analytics = recordingAnalytics(), engine: SyncEngine = fakeEngine()) {
  return {
    analytics,
    ...renderHook(() => useExportData(true), {
      wrapper: dataProviders({ db, analytics, engine }),
    }),
  }
}

describe('useExportData', () => {
  it('reads the counts only while open', async () => {
    const { result, rerender } = renderHook(({ open }: { open: boolean }) => useExportData(open), {
      wrapper: dataProviders({ db }),
      initialProps: { open: false },
    })
    expect(result.current.counts).toBeUndefined()
    expect(result.current.note).toBeNull()
    rerender({ open: true })
    await expect.poll(() => result.current.counts).toBeDefined()
    expect(result.current.note).toBe(EXPORT_COMPLETE_NOTE)
    expect(result.current.progress).toBeNull()
    expect(result.current.pending).toBe(false)
  })

  it('downloads the export and closes', async () => {
    vi.mocked(createExport).mockResolvedValue(ZIP)
    const { result } = setup()
    act(() => result.current.run())
    await expect.poll(() => result.current.closing).toBe(true)
    expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(ZIP.blob, ZIP.fileName)
    expect(result.current.error).toBeNull()
  })

  it('never downloads an export that finishes after Cancel', async () => {
    const held = heldExport()
    const { result } = setup()
    act(() => result.current.run())
    expect(result.current.pending).toBe(true)
    act(() => result.current.close())
    await act(async () => held.finish(ZIP))
    await expect.poll(() => result.current.pending).toBe(false)
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('says nothing went wrong when Cancel aborts the export', async () => {
    const held = heldExport()
    const { result } = setup()
    act(() => result.current.run())
    act(() => result.current.close())
    await act(async () => held.fail(new DOMException('Aborted', 'AbortError')))
    await expect.poll(() => result.current.pending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('reports a failed export and stays open', async () => {
    vi.mocked(createExport).mockRejectedValue(new Error('disk full'))
    const { result } = setup()
    act(() => result.current.run())
    await expect.poll(() => result.current.error).not.toBeNull()
    expect(result.current.closing).toBe(false)
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('export_completed', async () => {
    vi.mocked(createExport).mockResolvedValue(ZIP)
    const { result, analytics } = setup()
    act(() => result.current.run())
    await expect.poll(() => result.current.closing).toBe(true)
    expect(analytics.sends()).toEqual([{ name: 'export_completed', props: { format: 'zip' } }])
  })

  it('export_failed with other, and storage_full on QuotaExceededError', async () => {
    vi.mocked(createExport).mockRejectedValueOnce(new Error('boom'))
    const { result, analytics } = setup()
    act(() => result.current.run())
    await expect.poll(() => result.current.error).not.toBeNull()
    expect(analytics.sends()).toEqual([
      { name: 'export_failed', props: { format: 'zip', failure_reason: 'other' } },
    ])

    vi.mocked(createExport).mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    act(() => result.current.run())
    await expect.poll(() => analytics.sends().length).toBe(2)
    expect(analytics.sends()[1]).toEqual({
      name: 'export_failed',
      props: { format: 'zip', failure_reason: 'storage_full' },
    })
    expect(analytics.sends().some((send) => send.name === 'export_completed')).toBe(false)
  })

  it('fetches what the device is missing through the engine', async () => {
    vi.mocked(createExport).mockResolvedValue(ZIP)
    const fetched = new Blob(['a'])
    const fetchFile = vi.fn(async () => fetched)
    const { result } = setup(recordingAnalytics(), fakeEngine({ fetchFile }))
    act(() => result.current.run())
    await expect.poll(() => result.current.closing).toBe(true)
    const { fetchMissing } = vi.mocked(createExport).mock.calls[0]![2]
    await expect(fetchMissing('scan', 'p1')).resolves.toBe(fetched)
    expect(fetchFile).toHaveBeenCalledExactlyOnceWith('scan', 'p1')
  })

  it('offline with files to fetch, says so and refuses to export', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await db.recordings.put(recordingRow('r1'))
    const { result } = setup()
    await expect.poll(() => result.current.note).toBe(exportNeedsConnection(1))
    act(() => result.current.run())
    expect(result.current.pending).toBe(false)
    expect(createExport).not.toHaveBeenCalled()
  })

  it('offline with every file on the device, exports', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    vi.mocked(createExport).mockResolvedValue(ZIP)
    const { result } = setup()
    await expect.poll(() => result.current.note).toBe(EXPORT_COMPLETE_NOTE)
    act(() => result.current.run())
    await expect.poll(() => result.current.closing).toBe(true)
  })

  it('reports nothing for an export abandoned with Cancel', async () => {
    const held = heldExport()
    const { result, analytics } = setup()
    act(() => result.current.run())
    act(() => result.current.close())
    await act(async () => held.fail(new DOMException('Aborted', 'AbortError')))
    await expect.poll(() => result.current.pending).toBe(false)
    expect(analytics.sends()).toEqual([])
  })
})
