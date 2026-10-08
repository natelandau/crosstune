import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addLink } from '../../commands/links'
import { deleteRecording } from '../../commands/recordings'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { useDockItem } from './useDockItem'
import { PlayerContext, type PlayerItem } from './usePlayer'

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  db = openTestDb()
  tuneId = (await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })).tuneId
})

function setup(item: PlayerItem) {
  const close = vi.fn()
  const player = fakePlayer({ item, close })
  const Data = dataProviders({ db })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </Data>
  )
  return { ...renderHook(() => useDockItem(), { wrapper }), close }
}

describe('useDockItem', () => {
  it('closes the player when the recording is missing', async () => {
    const { result, close } = setup({ kind: 'recording', id: 'missing' })
    await expect.poll(() => close.mock.calls.length).toBe(1)
    expect(result.current.shown).toBeNull()
  })

  it('closes the player once the loaded recording is deleted', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: 'Jam' })
    const { result, close } = setup({ kind: 'recording', id })
    await expect.poll(() => result.current.shown?.kind).toBe('recording')
    await deleteRecording(db, id)
    await expect.poll(() => close.mock.calls.length).toBe(1)
  })

  it('shows a recording with its tune title', async () => {
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: null })
    const { result, close } = setup({ kind: 'recording', id })
    await expect.poll(() => result.current.shown?.kind).toBe('recording')
    expect(result.current.title).toBe('Cluck Old Hen')
    expect(result.current.recording?.id).toBe(id)
    expect(result.current.embed).toBeNull()
    expect(close).not.toHaveBeenCalled()
  })

  it('shows a link with its embed', async () => {
    const id = await addLink(db, tuneId, {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      provider_ref: 'dQw4w9WgXcQ',
      title: 'Cluck Old Hen on YouTube',
    })
    const { result } = setup({ kind: 'link', id })
    await expect.poll(() => result.current.shown?.kind).toBe('link')
    expect(result.current.title).toBe('Cluck Old Hen on YouTube')
    expect(result.current.embed).not.toBeNull()
  })
})
