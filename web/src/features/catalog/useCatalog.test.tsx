import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../../commands/songs'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { useCatalog } from './useCatalog'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createSong(db, { title: "Soldier's Joy" }, { status: 'known' })
})

afterEach(async () => {
  await db.delete()
})

function wrapper({ children }: { children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

/** Long enough for a live query to run, so "it never ran" is a claim about more than timing. */
const rest = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('useCatalog', () => {
  it('reads every song with its user row', async () => {
    const { result } = renderHook(() => useCatalog(), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0]!.song.title).toBe("Soldier's Joy")
  })

  it('stands the query down while disabled, and runs it once enabled', async () => {
    const reads = vi.spyOn(db.songs, 'toArray')
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
