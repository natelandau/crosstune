import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { UploadRecordingInput } from './UploadRecordingInput'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('UploadRecordingInput', () => {
  it('meets the minimum touch target height', async () => {
    renderWithProviders(<UploadRecordingInput songId={null} />, { db })
    expect(await screen.findByLabelText('Upload audio')).toHaveClass('min-h-11')
  })

  it('refuses a file that is not audio', async () => {
    renderWithProviders(<UploadRecordingInput songId={null} />, { db })
    const input = await screen.findByLabelText('Upload audio')
    // The input's accept attribute is only a picker hint; drag-drop and some OS
    // pickers can still deliver a mismatched file, so bypass it here.
    await userEvent
      .setup({ applyAccept: false })
      .upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an audio file.')
    expect(await db.recordings.count()).toBe(0)
  })

  it('refuses an empty file', async () => {
    renderWithProviders(<UploadRecordingInput songId={null} />, { db })
    const input = await screen.findByLabelText('Upload audio')
    await userEvent.upload(input, new File([], 'empty.wav', { type: 'audio/wav' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is empty.')
    expect(await db.recordings.count()).toBe(0)
  })

  it('refuses a file over the cached max size', async () => {
    await setStorage(db, { used_bytes: 0, quota_bytes: 1_000_000_000, max_file_bytes: 2 })
    renderWithProviders(<UploadRecordingInput songId={null} />, { db })
    const input = await screen.findByLabelText('Upload audio')
    await userEvent.upload(input, new File(['abc'], 'big.wav', { type: 'audio/wav' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Files are limited to 2 B.')
    expect(await db.recordings.count()).toBe(0)
  })
})
