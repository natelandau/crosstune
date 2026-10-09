import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../analytics/testing'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { useCatalogFilters } from './useCatalogFilters'

it('reports a filter once when two patches in one tick set it', async () => {
  const analytics = recordingAnalytics()
  const { result } = renderHook(() => useCatalogFilters(), {
    wrapper: dataProviders({ db: openTestDb(), analytics }),
  })
  await waitFor(() => expect(result.current[0]).toBeDefined())
  await act(async () => {
    const [, update] = result.current
    await Promise.all([update({ status: 'learning' }), update({ status: 'learning' })])
  })
  expect(analytics.sends()).toEqual([{ name: 'catalog_filtered', props: { filter: 'status' } }])
})

it('reports each kind a patch in the same tick adds', async () => {
  const analytics = recordingAnalytics()
  const { result } = renderHook(() => useCatalogFilters(), {
    wrapper: dataProviders({ db: openTestDb(), analytics }),
  })
  await waitFor(() => expect(result.current[0]).toBeDefined())
  await act(async () => {
    const [, update] = result.current
    await Promise.all([update({ status: 'learning' }), update({ archived: true })])
  })
  expect(analytics.sends().map((send) => send.props)).toEqual([
    { filter: 'status' },
    { filter: 'archived' },
  ])
  await act(async () => {
    await result.current[1]({ status: 'learning', archived: true })
  })
  expect(analytics.sends()).toHaveLength(2)
})

it('reports a filter applied again after its save failed', async () => {
  const analytics = recordingAnalytics()
  const db = openTestDb()
  const { result } = renderHook(() => useCatalogFilters(), {
    wrapper: dataProviders({ db, analytics }),
  })
  await waitFor(() => expect(result.current[0]).toBeDefined())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('disk full'))
  await act(async () => {
    await result.current[1]({ status: 'learning' }).catch(() => {})
  })
  await waitFor(() => expect(result.current[2]).not.toBeNull())
  expect(analytics.sends()).toEqual([])
  await act(async () => {
    await result.current[1]({ status: 'learning' })
  })
  expect(analytics.sends()).toEqual([{ name: 'catalog_filtered', props: { filter: 'status' } }])
})
