import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setInstruments, settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useInstruments } from './useInstruments'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

/** The hook's set, as a sorted array, or null while it is still reading. */
function played(instruments: ReadonlySet<string> | undefined): string[] | null {
  return instruments === undefined ? null : [...instruments].sort()
}

describe('useInstruments', () => {
  it('reports no instruments when the user has no settings row', async () => {
    const { result } = renderHook(() => useInstruments(), { wrapper: dataProviders({ db }) })
    await waitFor(() => expect(played(result.current)).toEqual([]))
  })

  it("reflects the signed-in user's row and follows changes", async () => {
    await setInstruments(db, 'user_1', ['five_string_banjo', 'violin'])
    await setInstruments(db, 'user_2', ['five_string_banjo'])
    const { result } = renderHook(() => useInstruments(), { wrapper: dataProviders({ db }) })
    await waitFor(() => expect(played(result.current)).toEqual(['five_string_banjo', 'violin']))
    await setInstruments(db, 'user_1', [])
    await waitFor(() => expect(played(result.current)).toEqual([]))
  })

  it('reads a stored banjo as the five-string banjo', async () => {
    await db.user_settings.put({
      id: settingsId('user_1'),
      created_at: 't',
      updated_at: 't',
      deleted_at: null,
      server_seq: 1,
      instruments: ['banjo', 'violin'],
      audio_quality: 'standard',
    })
    const { result } = renderHook(() => useInstruments(), { wrapper: dataProviders({ db }) })
    await waitFor(() => expect(played(result.current)).toEqual(['five_string_banjo', 'violin']))
  })
})
