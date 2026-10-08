import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { INSTRUMENT_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { NOT_SET } from '../../ui/fieldCopy'
import { useInstrumentsSetting } from './useInstrumentsSetting'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const setup = () => renderHook(() => useInstrumentsSetting(), { wrapper: dataProviders({ db }) })

describe('useInstrumentsSetting', () => {
  it('writes a toggled instrument and names it in the summary', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.instruments).toBeDefined()
    expect(result.current.summary).toBe(NOT_SET)
    act(() => result.current.toggle('mandolin', true))
    await expect.poll(() => result.current.instruments?.has('mandolin')).toBe(true)
    expect(result.current.summary).toBe(INSTRUMENT_LABELS.mandolin)
    act(() => result.current.toggle('violin', true))
    await expect
      .poll(() => result.current.summary)
      .toBe(`${INSTRUMENT_LABELS.violin}, ${INSTRUMENT_LABELS.mandolin}`)
    act(() => result.current.toggle('mandolin', false))
    await expect.poll(() => result.current.summary).toBe(INSTRUMENT_LABELS.violin)
    expect(result.current.error).toBeNull()
  })
})
