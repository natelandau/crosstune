import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { EMPTY_FILE_ERROR, NOT_AUDIO_ERROR, refusedFile } from './addAudioFiles'
import { useAudioImport } from './useAudioImport'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup() {
  const onError = vi.fn<(message: string | null) => void>()
  const { result } = renderHook(() => useAudioImport(null, onError), {
    wrapper: dataProviders({ db }),
  })
  return { importFiles: result.current, onError }
}

describe('useAudioImport', () => {
  it('clears the last refusal, then reports a file that is not audio', async () => {
    const { importFiles, onError } = setup()
    await importFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })])
    expect(onError.mock.calls).toEqual([[null], [NOT_AUDIO_ERROR]])
    expect(await db.recordings.count()).toBe(0)
  })

  it('names the first refused file of several', async () => {
    const { importFiles, onError } = setup()
    await importFiles([
      new File([], 'empty.m4a', { type: 'audio/mp4' }),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ])
    expect(onError).toHaveBeenLastCalledWith(refusedFile('empty.m4a', EMPTY_FILE_ERROR))
  })
})
