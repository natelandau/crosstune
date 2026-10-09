import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordingAnalytics } from '../../analytics/testing'
import type { Instrument } from '../../api/vocabulary'
import { setInstruments } from '../../commands/settings'
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

const setup = (analytics = recordingAnalytics()) => ({
  analytics,
  ...renderHook(() => useInstrumentsSetting(), { wrapper: dataProviders({ db, analytics }) }),
})

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

  it('reports the full resulting list after each toggle, in instrument order', async () => {
    const { result, analytics } = setup()
    await expect.poll(() => result.current.instruments).toBeDefined()
    act(() => result.current.toggle('mandolin', true))
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    act(() => result.current.toggle('violin', true))
    await expect.poll(() => analytics.sends()).toHaveLength(2)
    act(() => result.current.toggle('mandolin', false))
    await expect.poll(() => analytics.sends()).toHaveLength(3)
    expect(analytics.sends()).toEqual([
      { name: 'setting_changed', props: { setting: 'instruments', value: ['mandolin'] } },
      { name: 'setting_changed', props: { setting: 'instruments', value: ['violin', 'mandolin'] } },
      { name: 'setting_changed', props: { setting: 'instruments', value: ['violin'] } },
    ])
  })

  it('leaves an instrument the plan does not know out of the list', async () => {
    // Synced from the server, which can know an instrument before this client does.
    await setInstruments(db, 'user_1', ['theremin'] as unknown as Instrument[])
    const { result, analytics } = setup()
    await expect.poll(() => result.current.instruments).toBeDefined()
    act(() => result.current.toggle('guitar', true))
    await expect.poll(() => analytics.sends()).toHaveLength(1)
    expect(analytics.sends()).toEqual([
      { name: 'setting_changed', props: { setting: 'instruments', value: ['guitar'] } },
    ])
  })
})
