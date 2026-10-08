import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../../db/schema'
import { openTestDb } from '../../../test/db'
import { dataProviders } from '../../../test/providers'
import { EXPORT_COMPLETE_NOTE } from './exportCopy'
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

function setup() {
  return renderHook(() => useExportData(true), { wrapper: dataProviders({ db }) })
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
})
