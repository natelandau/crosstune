import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import * as tunes from '../../commands/tunes'
import { createTune, deleteTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { DELETE_TUNE_TITLE } from './deleteTuneMessage'
import { ARCHIVE, UNARCHIVE } from './archiveLabels'
import { useTuneScreen } from './useTuneScreen'

vi.mock('../../commands/tunes', { spy: true })

/** A promise and the function that settles it, for holding a write in flight. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

let db: CrosstuneDb
let ids: { tuneId: string; userTuneId: string }

beforeEach(async () => {
  db = openTestDb()
  ids = await createTune(
    db,
    {
      title: "Soldier's Joy",
      key: 'D',
      modes: ['major'],
      alternate_titles: ['Joy'],
      composer: 'Trad.',
      tunings: { violin: { tuning: 'Standard (GDAE)' } },
      is_crooked: true,
      genre: 'Old-time',
      lyrics: '  \n ',
    },
    {
      status: 'learning',
      notes: 'Watch the B part.',
      learned_from: 'Jim',
      learned_on: '2024-03-05',
    },
  )
})

afterEach(() => {
  // A one-off rejection a failed test left unconsumed must not reach the next test.
  vi.resetAllMocks()
})

async function press(result: { current: ReturnType<typeof useTuneScreen> }, label: string) {
  await act(async () =>
    result.current
      .menuFor(() => {})
      .find((item) => item.label === label)!
      .onPress(),
  )
}

function mount(tuneId = ids.tuneId, { answer = true }: { answer?: boolean } = {}) {
  const confirm = vi.fn(async () => answer)
  const leave = vi.fn()
  const hook = renderHook(() => useTuneScreen(tuneId, { confirm, leave }), {
    wrapper: dataProviders({ db }),
  })
  return { ...hook, confirm, leave }
}

describe('useTuneScreen', () => {
  it('reports neither a tune nor missing while it loads', async () => {
    const { result } = mount()
    expect(result.current.tune).toBeUndefined()
    expect(result.current.missing).toBe(false)
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.tune).toBeDefined())
  })

  it('assembles the facts, badges, and learned date once read', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    const { facts, badges, learnedOn, learnedFrom, notes } = result.current
    expect(facts).toMatchObject({
      title: "Soldier's Joy",
      alternateTitles: ['Joy'],
      composer: 'Trad.',
      key: 'D',
      modes: ['major'],
      status: 'learning',
      archived: false,
      hasLyrics: false,
    })
    expect(badges.map((badge) => badge.label)).toEqual([
      'Violin: Standard (GDAE)',
      'Crooked',
      'Old-time',
    ])
    expect(learnedOn).toBe('Mar 5, 2024')
    expect(learnedFrom).toBe('Jim')
    expect(notes).toBe('Watch the B part.')
  })

  it('reads a learned date with nothing set as null', async () => {
    const other = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const { result } = mount(other.tuneId)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.learnedOn).toBeNull()
    expect(result.current.facts?.hasLyrics).toBe(false)
  })

  it('lists the lists the tune is in, with the item that removes it', async () => {
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, ids.userTuneId)
    const { result } = mount()
    await waitFor(() => expect(result.current.inLists).toHaveLength(1))
    expect(result.current.inLists[0]).toMatchObject({ id: listId, name: 'Tuesday jam' })
    await act(async () => result.current.removeFromList(result.current.inLists[0]!.itemId))
    await waitFor(() => expect(result.current.inLists).toHaveLength(0))
  })

  it('reports an unknown tune as missing', async () => {
    const { result } = mount('no-such-tune')
    await waitFor(() => expect(result.current.missing).toBe(true))
    expect(result.current.tune).toBeUndefined()
  })

  it('reports a tune deleted elsewhere as missing once its row is gone', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.tune).toBeDefined())
    expect(result.current.missing).toBe(false)
    await deleteTune(db, ids.tuneId)
    await waitFor(() => expect(result.current.missing).toBe(true))
    expect(result.current.tune).toBeUndefined()
  })

  it('archives and unarchives through the menu', async () => {
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    const labels = () => result.current.menuFor(() => {}).map((item) => item.label)
    expect(labels()).toContain(ARCHIVE)
    await act(async () => {
      result.current
        .menuFor(() => {})
        .find((item) => item.label === ARCHIVE)!
        .onPress()
    })
    await waitFor(() => expect(result.current.facts?.archived).toBe(true))
    expect(labels()).toContain(UNARCHIVE)
  })

  it('asks before deleting, deletes, then leaves, without reporting the tune missing', async () => {
    const { result, confirm, leave } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () =>
      result.current
        .menuFor(() => {})
        .find((i) => i.label === 'Delete')!
        .onPress(),
    )
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: DELETE_TUNE_TITLE }))
    expect(result.current.deletingName).toBe("Soldier's Joy")
    // The live query reports the row gone; the page is leaving, so that is not "missing".
    await waitFor(() => expect(result.current.tune).toBeUndefined())
    expect(result.current.missing).toBe(false)
    expect((await db.tunes.get(ids.tuneId))?.deleted_at).toBeTruthy()
  })

  it('keeps the tune when the delete is declined', async () => {
    const { result, leave, confirm } = mount(ids.tuneId, { answer: false })
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () =>
      result.current
        .menuFor(() => {})
        .find((i) => i.label === 'Delete')!
        .onPress(),
    )
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(leave).not.toHaveBeenCalled()
    expect(result.current.deletingName).toBeNull()
    expect((await db.tunes.get(ids.tuneId))?.deleted_at).toBeNull()
  })

  it('shows a failed delete, stays on the tune, and lets the menu delete again', async () => {
    vi.mocked(tunes.deleteTune).mockRejectedValueOnce(new Error('Delete refused'))
    const { result, leave } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    await press(result, 'Delete')
    await waitFor(() => expect(result.current.error).toBe('Delete refused'))
    expect(result.current.deletingName).toBeNull()
    expect(result.current.tune).toBeDefined()
    expect(leave).not.toHaveBeenCalled()
    await press(result, 'Delete')
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1))
    expect(result.current.error).toBeNull()
  })

  it('shows the later of a delete error and an action error', async () => {
    vi.mocked(tunes.deleteTune).mockRejectedValueOnce(new Error('Delete refused'))
    vi.mocked(tunes.setArchived).mockRejectedValueOnce(new Error('Archive refused'))
    const { result } = mount()
    await waitFor(() => expect(result.current.ready).toBe(true))
    await press(result, 'Delete')
    await waitFor(() => expect(result.current.error).toBe('Delete refused'))
    await press(result, ARCHIVE)
    await waitFor(() => expect(result.current.error).toBe('Archive refused'))

    vi.mocked(tunes.deleteTune).mockRejectedValueOnce(new Error('Delete refused again'))
    await press(result, 'Delete')
    await waitFor(() => expect(result.current.error).toBe('Delete refused again'))
  })

  async function switching() {
    const other = await createTune(db, { title: 'Angeline' }, { status: 'known' })
    const confirm = vi.fn(async () => true)
    const leave = vi.fn()
    const hook = renderHook(({ id }) => useTuneScreen(id, { confirm, leave }), {
      wrapper: dataProviders({ db }),
      initialProps: { id: ids.tuneId },
    })
    await waitFor(() => expect(hook.result.current.ready).toBe(true))
    return { ...hook, other, leave }
  }

  it('clears the error line when another tune opens', async () => {
    vi.mocked(tunes.setArchived).mockRejectedValueOnce(new Error('Archive refused'))
    const { result, rerender, other } = await switching()
    await press(result, ARCHIVE)
    await waitFor(() => expect(result.current.error).toBe('Archive refused'))
    rerender({ id: other.tuneId })
    expect(result.current.error).toBeNull()
    await waitFor(() => expect(result.current.facts?.title).toBe('Angeline'))
  })

  it('drops a delete under way when another tune opens, and does not leave', async () => {
    const hold = gate()
    vi.mocked(tunes.deleteTune).mockImplementationOnce(() => hold.opened)
    const { result, rerender, other, leave } = await switching()
    await press(result, 'Delete')
    await waitFor(() => expect(result.current.deletingName).toBe("Soldier's Joy"))
    rerender({ id: other.tuneId })
    expect(result.current.deletingName).toBeNull()
    hold.open()
    await waitFor(() => expect(result.current.facts?.title).toBe('Angeline'))
    expect(leave).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('shows no error from the old tune once the next tune is open', async () => {
    const hold = gate()
    vi.mocked(tunes.setArchived).mockImplementationOnce(async () => {
      await hold.opened
      throw new Error('Archive refused')
    })
    const { result, rerender, other } = await switching()
    await press(result, ARCHIVE)
    rerender({ id: other.tuneId })
    await waitFor(() => expect(result.current.facts?.title).toBe('Angeline'))
    expect(result.current.pending).toBe(true)
    hold.open()
    // The refusal lands after the switch; pending falling means the old action has settled.
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.error).toBeNull()
  })
})
