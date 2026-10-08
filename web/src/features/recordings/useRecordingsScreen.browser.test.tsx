import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import { META_RECORDINGS_ORIGIN, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { PlayerContext } from '../player/usePlayer'
import { NOT_AUDIO_ERROR } from './addAudioFiles'
import { GO_TO_TUNE } from './recordingNames'
import { useRecordingsScreen } from './useRecordingsScreen'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup() {
  const Data = dataProviders({ db })
  const player = fakePlayer()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
    </Data>
  )
  const confirm = vi.fn().mockResolvedValue(true)
  const onOpenTune = vi.fn()
  const view = renderHook(() => useRecordingsScreen({ confirm, onOpenTune }), { wrapper })
  return { ...view, confirm, onOpenTune }
}

describe('useRecordingsScreen', () => {
  it('hides Filters while loading', async () => {
    await db.recordings.put(recordingRow('r1', { origin: 'slippery_hill' }))
    const { result } = setup()
    expect(result.current.ready).toBe(false)
    expect(result.current.showsFilters).toBe(false)
    await expect.poll(() => result.current.showsFilters).toBe(true)
  })

  it('hides Filters while every recording is the musician’s own', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.total).toBe(1)
    expect(result.current.showsFilters).toBe(false)
  })

  it('shows Filters once an import gives the sources something to tell apart', async () => {
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    await db.recordings.put(recordingRow('r2', { label: 'Imported', origin: 'slippery_hill' }))
    const { result } = setup()
    await expect.poll(() => result.current.showsFilters).toBe(true)
    expect(result.current.origins).toEqual(['slippery_hill'])
  })

  it('keeps Filters while a source is set and no import is left', async () => {
    await setMeta(db, META_RECORDINGS_ORIGIN, 'slippery_hill')
    await db.recordings.put(recordingRow('r1', { label: 'Jam recording' }))
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.source).toBe('slippery_hill')
    expect(result.current.filterSet).toBe(true)
    expect(result.current.showsFilters).toBe(true)
    expect(result.current.listed).toBe(0)
    act(() => result.current.setSource('all'))
    await expect.poll(() => result.current.showsFilters).toBe(false)
    expect(result.current.listed).toBe(1)
  })

  it('refuses a file that is not audio', async () => {
    const { result } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    const notes = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    await act(() => result.current.importFiles([notes]))
    await expect.poll(() => result.current.error).toBe(NOT_AUDIO_ERROR)
    expect(await db.recordings.count()).toBe(0)
  })

  it('lists Unfiled apart from the filed recordings and opens a filed one’s tune', async () => {
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    await db.recordings.put(recordingRow('r1', { label: 'Loose take' }))
    await db.recordings.put(recordingRow('r2', { label: 'Filed take', tune_id: tuneId }))
    const { result, onOpenTune } = setup()
    await expect.poll(() => result.current.ready).toBe(true)
    expect(result.current.total).toBe(2)
    expect(result.current.countLabel).toBe('2 recordings')
    expect(result.current.unfiled.map((view) => view.recording.id)).toEqual(['r1'])
    const filed = result.current.filed
    expect(filed.kind === 'flat' ? filed.views.map((view) => view.recording.id) : []).toEqual([
      'r2',
    ])
    const go = (id: string) =>
      [...result.current.unfiled, ...(filed.kind === 'flat' ? filed.views : [])].find(
        (view) => view.recording.id === id,
      )!
    expect(result.current.actionsFor(go('r1')).map((action) => action.label)).not.toContain(
      GO_TO_TUNE,
    )
    act(() =>
      result.current
        .actionsFor(go('r2'))
        .find((action) => action.label === GO_TO_TUNE)!
        .onPress(),
    )
    expect(onOpenTune).toHaveBeenCalledExactlyOnceWith(tuneId)
  })
})
