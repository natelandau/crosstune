import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../../../db/schema'
import { openTestDb } from '../../../test/db'
import { renderIonic } from '../../../test/ionic'
import { recordingFile, recordingRow } from '../../../test/rows'
import { CANCEL } from '../../../ui/Confirm'
import {
  EXPORT_ACTION,
  EXPORT_COMPLETE_NOTE,
  EXPORT_TITLE,
  exportMissingNote,
  exportProgress,
} from './exportCopy'
import { ExportSheet } from './ExportSheet'
import { createExport, downloadBlob } from './runExport'

vi.mock('./runExport', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  vi.mocked(downloadBlob).mockImplementation(() => {})
})

afterEach(async () => {
  await db.delete()
})

const blob = () => new Blob([new Uint8Array([1])], { type: 'audio/mp4' })

describe('ExportSheet', () => {
  it('shows how many recordings are on the device', async () => {
    await db.recordings.bulkPut([recordingRow('a'), recordingRow('b'), recordingRow('c')])
    await db.recording_files.put(recordingFile('a', { blob: blob(), local_state: 'uploaded' }))
    renderIonic(<ExportSheet open onClose={() => {}} />, { db })
    await expect.element(page.getByText(exportMissingNote(1, 3))).toBeVisible()
  })

  it('shows the complete note when nothing is missing', async () => {
    await db.recordings.put(recordingRow('a'))
    await db.recording_files.put(recordingFile('a', { blob: blob(), local_state: 'uploaded' }))
    renderIonic(<ExportSheet open onClose={() => {}} />, { db })
    await expect.element(page.getByText(EXPORT_COMPLETE_NOTE)).toBeVisible()
  })

  it('exports, downloads, and closes', async () => {
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toMatch(
      /^crosstune-export-\d{4}-\d{2}-\d{2}\.zip$/,
    )
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('Cancel closes the sheet without downloading', async () => {
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await expect.element(page.getByRole('heading', { name: EXPORT_TITLE })).toBeVisible()
    await page.getByRole('button', { name: CANCEL }).click()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('does not download an export that finishes after Cancel', async () => {
    let finish: (value: { fileName: string; blob: Blob }) => void = () => {}
    vi.mocked(createExport).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await vi.waitFor(() => expect(createExport).toHaveBeenCalledOnce())
    await page.getByRole('button', { name: CANCEL }).click()
    finish({ fileName: 'x.zip', blob: blob() })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('shows a failure and stays open', async () => {
    vi.mocked(createExport).mockRejectedValueOnce(new Error('Disk full'))
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(onClose).not.toHaveBeenCalled()
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('shows no error when Cancel aborts the export', async () => {
    let fail: (reason: unknown) => void = () => {}
    vi.mocked(createExport).mockImplementationOnce(
      (_db, _user, options) =>
        new Promise((_resolve, reject) => {
          fail = reject
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
    )
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await vi.waitFor(() => expect(createExport).toHaveBeenCalledOnce())
    await page.getByRole('button', { name: CANCEL }).click()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    fail(new Error('late'))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows progress while an export runs', async () => {
    vi.mocked(createExport).mockImplementationOnce((_db, _user, options) => {
      options.onProgress?.(1, 3)
      return new Promise(() => {})
    })
    renderIonic(<ExportSheet open onClose={() => {}} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent(exportProgress(1, 3))
  })

  it('refuses dismissal while exporting', async () => {
    vi.mocked(createExport).mockReturnValueOnce(new Promise(() => {}))
    const onClose = vi.fn()
    renderIonic(<ExportSheet open onClose={onClose} />, { db })
    await page.getByRole('button', { name: EXPORT_ACTION, exact: true }).click()
    await vi.waitFor(() => expect(createExport).toHaveBeenCalledOnce())
    await userEvent.keyboard('{Escape}')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(onClose).not.toHaveBeenCalled()
    await expect.element(page.getByRole('heading', { name: EXPORT_TITLE })).toBeVisible()
  })
})
