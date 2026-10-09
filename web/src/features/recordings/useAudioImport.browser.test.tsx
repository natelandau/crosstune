import { renderHook } from '@testing-library/react'
import { recordingAnalytics } from '../../usage/testing'
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
  const analytics = recordingAnalytics()
  const { result } = renderHook(() => useAudioImport(null, onError), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { importFiles: result.current, onError, analytics }
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

  it('sends audio_imported once per format with the count bucket', async () => {
    const { importFiles, analytics } = setup()
    await importFiles([
      new File(['a'], 'one.m4a', { type: 'audio/mp4' }),
      new File(['b'], 'two.m4a', { type: 'audio/mp4' }),
      new File(['c'], 'three.MP3', { type: 'audio/mpeg' }),
      new File(['d'], 'four.ogg', { type: 'audio/ogg' }),
      new File(['e'], 'notes.txt', { type: 'text/plain' }),
    ])

    expect(analytics.sends()).toEqual([
      { name: 'audio_imported', props: { count_bucket: '1-9', format: 'm4a' } },
      { name: 'audio_imported', props: { count_bucket: '1-9', format: 'mp3' } },
      { name: 'audio_imported', props: { count_bucket: '1-9', format: 'other' } },
    ])
  })

  it('sends nothing when every file is refused', async () => {
    const { importFiles, onError, analytics } = setup()
    await importFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })])

    expect(onError).toHaveBeenLastCalledWith(NOT_AUDIO_ERROR)
    expect(analytics.sends()).toEqual([])
  })
})
