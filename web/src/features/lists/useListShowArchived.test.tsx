import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { META_LIST_SHOW_ARCHIVED, useListShowArchived } from './useListShowArchived'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('useListShowArchived', () => {
  it('hides archived tunes until asked, and saves the choice', async () => {
    const { result } = renderHook(() => useListShowArchived(), {
      wrapper: dataProviders({ db }),
    })
    await waitFor(() => expect(result.current[0]).toBe(false))
    await act(async () => {
      await result.current[1](true)
    })
    await waitFor(() => expect(result.current[0]).toBe(true))
    expect(await getMeta(db, META_LIST_SHOW_ARCHIVED, null)).toBe(true)
  })
})
