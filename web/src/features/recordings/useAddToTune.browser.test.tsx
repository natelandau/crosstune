import { act, renderHook } from '@testing-library/react'
import { recordingAnalytics } from '../../analytics/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { recordingRow } from '../../test/rows'
import { filedToast } from './recordingsCopy'
import { useAddToTune } from './useAddToTune'
import type { RecordingView } from './useRecordings'

let db: CrosstuneDb

const unfiled = (id: string): RecordingView => ({
  recording: recordingRow(id, { label: 'Jam recording' }),
  file: undefined,
  tuneId: null,
  tuneTitle: null,
})

beforeEach(() => {
  db = openTestDb()
})

function setup(view: RecordingView | null) {
  const toast = vi.fn<(message: string, undo?: () => void) => void>()
  const onClose = vi.fn()
  const analytics = recordingAnalytics()
  const hook = renderHook(
    ({ target }: { target: RecordingView | null }) => useAddToTune(target, { toast, onClose }),
    { wrapper: dataProviders({ db, analytics }), initialProps: { target: view } },
  )
  return { ...hook, toast, onClose, analytics }
}

describe('useAddToTune', () => {
  it('files the recording under a picked tune and offers Undo', async () => {
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    await db.recordings.put(unfiled('r1').recording)
    const { result, toast } = setup(unfiled('r1'))
    act(() => result.current.setQuery('soldier'))
    await expect.poll(() => result.current.matches.matches.map((e) => e.tune.id)).toEqual([tuneId])
    act(() => result.current.pick(tuneId))
    await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe(tuneId)
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    const [message, undo] = toast.mock.calls[0]!
    expect(message).toBe(filedToast("Soldier's Joy"))
    await expect.poll(() => result.current.open).toBe(false)
    undo!()
    await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBeNull()
  })

  it('undoes a pick to Unfiled when the stored tune was deleted elsewhere', async () => {
    const gone = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
    await db.tunes.update(gone.tuneId, { deleted_at: '2026-01-02T00:00:00.000Z' })
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    const view: RecordingView = {
      ...unfiled('r1'),
      recording: recordingRow('r1', { label: 'Jam recording', tune_id: gone.tuneId }),
    }
    await db.recordings.put(view.recording)
    const { result, toast } = setup(view)
    act(() => result.current.setQuery('soldier'))
    await expect.poll(() => result.current.matches.matches.map((e) => e.tune.id)).toEqual([tuneId])
    act(() => result.current.pick(tuneId))
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    toast.mock.calls[0]![1]!()
    await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBeNull()
    expect(toast).toHaveBeenCalledOnce()
  })

  it('hands the typed title back once dismissed', async () => {
    await db.recordings.put(unfiled('r1').recording)
    const { result, onClose } = setup(unfiled('r1'))
    act(() => result.current.create('Kesh Jig'))
    expect(result.current.open).toBe(false)
    let title: string | null = null
    act(() => {
      title = result.current.dismissed()
    })
    expect(title).toBe('Kesh Jig')
    expect(onClose).toHaveBeenCalledOnce()
  })

  describe('analytics', () => {
    it('sends recording_filed from unfiled with the origin and ids', async () => {
      const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
      await db.recordings.put(unfiled('r1').recording)
      const { result, analytics } = setup(unfiled('r1'))

      act(() => result.current.pick(tuneId))

      await expect
        .poll(() => analytics.sends())
        .toEqual([
          {
            name: 'recording_filed',
            props: { from: 'unfiled', origin: 'recorded', recording_id: 'r1', tune_id: tuneId },
          },
        ])
    })

    it('sends recording_filed from another tune, and nothing for the undo', async () => {
      const first = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
      const second = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
      const row = recordingRow('r1', { label: 'Jam recording', tune_id: first.tuneId })
      await db.recordings.put(row)
      const view: RecordingView = { ...unfiled('r1'), recording: row, tuneId: first.tuneId }
      const { result, toast, analytics } = setup(view)
      act(() => result.current.setQuery('soldier'))
      await expect.poll(() => result.current.matches.matches.length).toBe(1)

      act(() => result.current.pick(second.tuneId))
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      toast.mock.calls[0]![1]!()
      await expect.poll(async () => (await db.recordings.get('r1'))?.tune_id).toBe(first.tuneId)

      expect(analytics.sends()).toEqual([
        {
          name: 'recording_filed',
          props: {
            from: 'other_tune',
            origin: 'recorded',
            recording_id: 'r1',
            tune_id: second.tuneId,
          },
        },
      ])
    })

    it('classifies by the stored tune, so a recording under a deleted tune files from another tune', async () => {
      const gone = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
      await db.tunes.update(gone.tuneId, { deleted_at: '2026-01-02T00:00:00.000Z' })
      const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
      const row = recordingRow('r1', { label: 'Jam recording', tune_id: gone.tuneId })
      await db.recordings.put(row)
      const view: RecordingView = { ...unfiled('r1'), recording: row, tuneId: null }
      const { result, analytics } = setup(view)

      act(() => result.current.pick(tuneId))

      await expect
        .poll(() => analytics.sends())
        .toEqual([
          {
            name: 'recording_filed',
            props: { from: 'other_tune', origin: 'recorded', recording_id: 'r1', tune_id: tuneId },
          },
        ])
    })
  })
})
