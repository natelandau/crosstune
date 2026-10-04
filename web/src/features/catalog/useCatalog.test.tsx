import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { linkRow, recordingRow } from '../../test/rows'
import { useCatalog } from './useCatalog'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
})

function wrapper({ children }: { children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

/** Long enough for a live query to run, so "it never ran" is a claim about more than timing. */
const rest = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('useCatalog', () => {
  it('marks a tune heard only while a recording or link of it is live', async () => {
    const tuneId = (await db.tunes.toArray())[0]!.id
    const { result } = renderHook(() => useCatalog(true, { heard: true }), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0]!.heard).toBe(false)
    await db.recordings.put(recordingRow('r1', { tune_id: tuneId, deleted_at: 't' }))
    await db.recording_links.put(linkRow('l1', tuneId))
    await waitFor(() => expect(result.current![0]!.heard).toBe(true))
    await db.recording_links.update('l1', { deleted_at: 't' })
    await waitFor(() => expect(result.current![0]!.heard).toBe(false))
  })

  it('leaves recordings and links unread unless heard is asked for', async () => {
    const tuneId = (await db.tunes.toArray())[0]!.id
    await db.recording_links.put(linkRow('l1', tuneId))
    const reads = vi.spyOn(db.recordings, 'where')
    const { result } = renderHook(() => useCatalog(), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0]!.heard).toBe(false)
    expect(reads).not.toHaveBeenCalled()
  })

  it('ignores a recording filed under no tune', async () => {
    await db.recordings.put(recordingRow('r1', { tune_id: null }))
    const { result } = renderHook(() => useCatalog(true, { heard: true }), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0]!.heard).toBe(false)
  })

  it('reads every tune with its user row', async () => {
    const { result } = renderHook(() => useCatalog(), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0]!.tune.title).toBe("Soldier's Joy")
  })

  it('stands the query down while disabled, and runs it once enabled', async () => {
    const reads = vi.spyOn(db.tunes, 'toArray')
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useCatalog(on), {
      wrapper,
      initialProps: { on: false },
    })
    await rest()
    expect(reads).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
    rerender({ on: true })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(reads).toHaveBeenCalled()
  })
})
