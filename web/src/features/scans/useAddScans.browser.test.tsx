import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SCANS } from '../../commands/scans'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { prepareImage, UndecodableImageError } from './prepareImage'
import { scansNotAddedMessage, unreadableFilesMessage } from './scanCopy'
import { useAddScans } from './useAddScans'

vi.mock('./prepareImage', { spy: true })

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  ;({ tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' }))
  // A picked file's width is its name's length, so the stored scans say which file each was.
  vi.mocked(prepareImage).mockImplementation(async (file) => {
    if (!file.type.startsWith('image/')) throw new UndecodableImageError(file.name, null)
    return {
      blob: new Blob([file.name], { type: 'image/jpeg' }),
      width: file.name.length,
      height: 1,
    }
  })
})

const image = (name: string) => new File(['x'], name, { type: 'image/png' })

async function storedWidths(): Promise<number[]> {
  const scans = await db.scans.where('tune_id').equals(tuneId).sortBy('position')
  return scans.filter((scan) => !scan.deleted_at).map((scan) => scan.width)
}

function setup(count = 0) {
  return renderHook(() => useAddScans(tuneId, count), { wrapper: dataProviders({ db }) })
}

describe('useAddScans', () => {
  it('adds the picked files in the order they were picked', async () => {
    const { result } = setup()
    await act(() => result.current.add([image('a.png'), image('bb.png'), image('ccc.png')]))
    expect(await storedWidths()).toEqual([5, 6, 7])
    expect(result.current.error).toBeNull()
    expect(result.current.adding).toBe(false)
  })

  it('names a file it cannot read and adds the rest', async () => {
    const { result } = setup()
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await act(() => result.current.add([image('a.png'), text, image('bb.png')]))
    expect(await storedWidths()).toEqual([5, 6])
    expect(result.current.error).toBe(unreadableFilesMessage(['notes.txt']))
  })

  it('stops where the tune is full and says how many were left out', async () => {
    const { result } = setup(MAX_SCANS - 1)
    await act(() => result.current.add([image('a.png'), image('bb.png'), image('ccc.png')]))
    expect(await storedWidths()).toEqual([5])
    expect(result.current.error).toBe(scansNotAddedMessage(2))
  })
})
