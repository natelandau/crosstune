import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TuneStatus } from '../../api/vocabulary'
import * as bulk from '../../commands/bulk'
import { activeItems, addToList, createList } from '../../commands/lists'
import { recordingAnalytics } from '../../analytics/testing'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { recordingRow } from '../../test/rows'
import { DELETE } from '../../ui/confirmCopy'
import type { CatalogEntry } from '../catalog/filters'
import { isNotUploaded } from '../../db/recordings'
import { deleteTunesMessage } from '../tune/deleteTuneMessage'
import { countTunes } from './copy'
import {
  archiveLabel,
  archivedToast,
  deleteTunesLabel,
  editedToast,
  removedFromListToast,
  removeFromListLabel,
  setStatusLabel,
} from './selectionCopy'
import { useBulkActionsWith, type SelectionContext } from './useBulkActionsWith'

vi.mock('../../commands/bulk', { spy: true })

const CATALOG: SelectionContext = { kind: 'catalog' }
const TITLES = ["Soldier's Joy", 'Cluck Old Hen', 'Angeline the Baker']

let db: CrosstuneDb
let entries: CatalogEntry[]

beforeEach(async () => {
  db = openTestDb()
  entries = []
  for (const title of TITLES) {
    const { tuneId, userTuneId } = await createTune(db, { title }, { status: 'want_to_learn' })
    entries.push({
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    })
  }
})

function setup(context: SelectionContext = CATALOG, answer = true) {
  const confirm = vi.fn().mockResolvedValue(answer)
  const toast = vi.fn<(message: string, undo?: () => void) => void>()
  const onExit = vi.fn()
  const analytics = recordingAnalytics()
  const view = renderHook(() => useBulkActionsWith({ entries, context, onExit, confirm, toast }), {
    wrapper: dataProviders({ db, analytics }),
  })
  return { ...view, confirm, toast, onExit, analytics }
}

const ids = () => entries.map((entry) => entry.userTune.id)
const statuses = async () =>
  Promise.all(ids().map(async (id) => (await db.user_tunes.get(id))!.status))
const lastUndo = (toast: ReturnType<typeof setup>['toast']) => toast.mock.lastCall![1]!

function press(items: readonly { label: string; onPress: () => void }[], label: string) {
  const item = items.find((candidate) => candidate.label === label)
  if (!item) throw new Error(`No item named ${label}`)
  act(() => item.onPress())
}

describe('useBulkActionsWith', () => {
  it('sets status on every tune, toasts, and undoes each', async () => {
    const { result, toast, onExit, confirm } = setup()
    press(result.current.statusItems, STATUS_LABELS.known)

    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(toast.mock.lastCall![0]).toBe(setStatusLabel(3, 'known'))
    expect(await statuses()).toEqual<TuneStatus[]>(['known', 'known', 'known'])
    await expect.poll(() => onExit.mock.calls.length).toBe(1)
    expect(confirm).not.toHaveBeenCalled()

    await act(async () => lastUndo(toast)())
    await expect
      .poll(statuses)
      .toEqual<TuneStatus[]>(['want_to_learn', 'want_to_learn', 'want_to_learn'])
  })

  it('archives with Undo and no confirm', async () => {
    const { result, toast, confirm } = setup()
    press(result.current.more, archiveLabel(3, true))
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(toast.mock.lastCall![0]).toBe(archivedToast(3, true))
    expect(confirm).not.toHaveBeenCalled()
    expect((await db.user_tunes.get(ids()[0]!))!.archived_at).not.toBeNull()
  })

  it('confirms a delete and raises no toast', async () => {
    const { result, confirm, toast, onExit } = setup()
    press(result.current.more, deleteTunesLabel(3))
    await expect.poll(() => onExit.mock.calls.length).toBe(1)
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: `${deleteTunesLabel(3)}?`, action: DELETE }),
    )
    expect(toast).not.toHaveBeenCalled()
    expect((await db.tunes.get(entries[0]!.tune.id))!.deleted_at).not.toBeNull()
  })

  it('counts the recordings the delete takes and warns about one not uploaded', async () => {
    const unsent = await captureRecording(db, { tuneId: entries[0]!.tune.id })
    await db.recordings.put(recordingRow('sent', { tune_id: entries[1]!.tune.id }))
    const { result, confirm } = setup(CATALOG, false)
    press(result.current.more, deleteTunesLabel(3))
    await expect.poll(() => confirm.mock.calls.length).toBe(1)
    const unsentFile = await db.recording_files.get(unsent)
    expect(isNotUploaded(unsentFile)).toBe(true)
    expect(confirm.mock.calls[0]![0]).toMatchObject({
      message: deleteTunesMessage(countTunes(3), [{ file: unsentFile }, { file: undefined }]),
    })
  })

  it('keeps the mode and reports the error when a status write fails', async () => {
    vi.mocked(bulk.updateTunes).mockRejectedValueOnce(new Error('Disk full'))
    const { result, onExit, toast } = setup()
    press(result.current.statusItems, STATUS_LABELS.known)
    await expect.poll(() => result.current.error).toBe('Disk full')
    expect(onExit).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(result.current.ids).toEqual(ids())
  })

  it('keeps the mode and reports the error when a More write fails', async () => {
    vi.mocked(bulk.setArchivedMany).mockRejectedValueOnce(new Error('Disk full'))
    const { result, onExit } = setup()
    press(result.current.more, archiveLabel(3, true))
    await expect.poll(() => result.current.error).toBe('Disk full')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('offers Archive and Unarchive together for a mixed selection', () => {
    entries[0] = { ...entries[0]!, userTune: { ...entries[0]!.userTune, archived_at: 'then' } }
    const { result } = setup()
    const labels = result.current.more.map((item) => item.label)
    expect(labels).toContain(archiveLabel(2, true))
    expect(labels).toContain(archiveLabel(1, false))
  })

  it('omits Archive when every selected tune is already archived', () => {
    entries = entries.map((entry) => ({
      ...entry,
      userTune: { ...entry.userTune, archived_at: 'then' },
    }))
    const { result } = setup()
    const labels = result.current.more.map((item) => item.label)
    expect(labels).not.toContain(archiveLabel(3, true))
    expect(labels).toContain(archiveLabel(3, false))
  })

  it('deletes nothing when the delete is declined', async () => {
    const { result, confirm, onExit } = setup(CATALOG, false)
    press(result.current.more, deleteTunesLabel(3))
    await expect.poll(() => confirm.mock.calls.length).toBe(1)
    // The hook's own await on the answer resumes first, so by now a delete would have started.
    await act(async () => {
      await confirm.mock.results[0]!.value
    })
    expect(bulk.deleteTunes).not.toHaveBeenCalled()
    expect(onExit).not.toHaveBeenCalled()
    expect((await db.tunes.get(entries[0]!.tune.id))!.deleted_at).toBeNull()
  })

  it('removes the tunes from a list with Undo', async () => {
    const listId = await createList(db, 'Tuesday jam')
    for (const id of ids()) await addToList(db, listId, id)
    const items = await activeItems(db, listId)
    const context: SelectionContext = {
      kind: 'list',
      listId,
      listName: 'Tuesday jam',
      itemIdByUserTune: new Map(items.map((item) => [item.user_tune_id, item.id])),
    }
    const { result, toast } = setup(context)
    press(result.current.more, removeFromListLabel(3))
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(toast.mock.lastCall![0]).toBe(removedFromListToast(3, 'Tuesday jam'))
    expect(await activeItems(db, listId)).toEqual([])
    await act(async () => lastUndo(toast)())
    await expect.poll(async () => (await activeItems(db, listId)).length).toBe(3)
  })

  it('applies an edit, closes the sheet, and toasts with Undo', async () => {
    const { result, toast, onExit } = setup()
    act(() => result.current.setSheet('edit'))
    expect(result.current.sheet).toBe('edit')
    act(() => result.current.edit.apply({ tune: { key: 'G' } }))
    await expect.poll(() => toast.mock.calls.length).toBe(1)
    expect(toast.mock.lastCall![0]).toBe(editedToast(3))
    await expect.poll(() => result.current.sheet).toBeNull()
    await expect.poll(() => onExit.mock.calls.length).toBe(1)
    expect((await db.tunes.get(entries[1]!.tune.id))!.key).toBe('G')
  })

  describe('analytics', () => {
    it('reports tunes removed from a list, and nothing for the undo', async () => {
      const listId = await createList(db, 'Tuesday jam')
      for (const entry of entries) await addToList(db, listId, entry.userTune.id)
      const items = await activeItems(db, listId)
      const context: SelectionContext = {
        kind: 'list',
        listId,
        listName: 'Tuesday jam',
        itemIdByUserTune: new Map(items.map((item) => [item.user_tune_id, item.id])),
      }
      const { result, toast, analytics } = setup(context)
      press(result.current.more, removeFromListLabel(3))
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        { name: 'tunes_removed_from_list', props: { list_id: listId, count_bucket: '1-9' } },
      ])
      await act(async () => lastUndo(toast)())
      await expect.poll(async () => (await activeItems(db, listId)).length).toBe(3)
      expect(analytics.sends()).toHaveLength(1)
    })

    it('reports a bulk status with the count bucket', async () => {
      const { result, toast, analytics } = setup()
      press(result.current.statusItems, STATUS_LABELS.known)
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        {
          name: 'bulk_edit_applied',
          props: { count_bucket: '1-9', action: 'status', fields_changed: ['status'] },
        },
      ])
    })

    it('reports archive for either direction, counting the tunes changed', async () => {
      const { result, toast, analytics } = setup()
      press(result.current.more, archiveLabel(3, true))
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        { name: 'bulk_edit_applied', props: { count_bucket: '1-9', action: 'archive' } },
      ])
    })

    it('reports an edit with the fields the patch writes', async () => {
      const { result, toast, analytics } = setup()
      act(() => result.current.edit.apply({ tune: { key: 'G', modes: ['dorian'] } }))
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        {
          name: 'bulk_edit_applied',
          props: { count_bucket: '1-9', action: 'edit', fields_changed: ['key', 'mode'] },
        },
      ])
    })

    it('reports a confirmed delete', async () => {
      const { result, onExit, analytics } = setup()
      press(result.current.more, deleteTunesLabel(3))
      await expect.poll(() => onExit.mock.calls.length).toBe(1)
      expect(analytics.sends()).toEqual([
        { name: 'bulk_edit_applied', props: { count_bucket: '1-9', action: 'delete' } },
      ])
    })

    it('sends nothing when the undo runs', async () => {
      const { result, toast, analytics } = setup()
      press(result.current.statusItems, STATUS_LABELS.known)
      await expect.poll(() => toast.mock.calls.length).toBe(1)
      await act(async () => lastUndo(toast)())
      await expect.poll(statuses).toEqual(['want_to_learn', 'want_to_learn', 'want_to_learn'])
      expect(analytics.sends()).toHaveLength(1)
    })

    it('sends nothing when the write fails', async () => {
      vi.mocked(bulk.updateTunes).mockRejectedValueOnce(new Error('Disk full'))
      const { result, analytics } = setup()
      press(result.current.statusItems, STATUS_LABELS.known)
      await expect.poll(() => result.current.error).toBe('Disk full')
      expect(analytics.sends()).toEqual([])
    })
  })
})
