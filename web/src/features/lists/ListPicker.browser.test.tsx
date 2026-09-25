import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import * as bulk from '../../commands/bulk'
import { addToList, createList } from '../../commands/lists'
import { createTune } from '../../commands/tunes'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { ListPicker, NEW_LIST_ITEM, NEW_LIST_NAME_LABEL, type ListAddition } from './ListPicker'
import type * as UseListsModule from './useLists'

vi.mock('../../commands/bulk', { spy: true })

// Set by a test that needs to hold membership counts at "still loading"; a promise the test
// resolves once it has asserted the loading state, and undefined the rest of the time.
let membershipGate: Promise<void> | undefined

vi.mock('./useLists', async (importOriginal) => {
  const actual = await importOriginal<typeof UseListsModule>()
  return {
    ...actual,
    useMembershipCounts(userTuneIds: readonly string[]) {
      const counts = actual.useMembershipCounts(userTuneIds)
      const [ready, setReady] = useState(membershipGate === undefined)
      useEffect(() => {
        const wait = membershipGate
        if (!wait) return
        let cancelled = false
        void wait.then(() => {
          if (!cancelled) setReady(true)
        })
        return () => {
          cancelled = true
        }
      }, [])
      return ready ? counts : undefined
    },
  }
})

/** A promise and the function that settles it, for holding membership loading in place. */
function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

function Host({
  userTuneIds,
  excludeListId,
  onClose,
  onAdded,
}: {
  userTuneIds: string[]
  excludeListId?: string
  onClose?: () => void
  onAdded?: (addition: ListAddition) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <ListPicker
      open={open}
      userTuneIds={userTuneIds}
      excludeListId={excludeListId}
      title="Add to a list"
      onAdded={onAdded}
      onClose={() => {
        onClose?.()
        setOpen(false)
      }}
    />
  )
}

const sheetDismissed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull())

describe('ListPicker', () => {
  it('adds the tune to a picked list and marks a list it is already in', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    const set = await createList(db, 'Square dance set')
    await addToList(db, set, userTuneId)
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await expect.element(page.getByText('Add to a list')).toBeVisible()
    await expect.element(page.getByText('all in it')).toBeVisible()
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await vi.waitFor(async () => {
      const items = await db.list_items.where('list_id').equals(jam).toArray()
      expect(items.filter((item) => !item.deleted_at)).toHaveLength(1)
    })
  })

  it('titles itself by the number of tunes for a two-tune selection', async () => {
    const db = openTestDb()
    const { userTuneId: a } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { userTuneId: b } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'known' })
    renderIonic(<ListPicker open userTuneIds={[a, b]} onClose={() => {}} />, { db })
    await expect.element(page.getByText('Add 2 tunes to a list')).toBeVisible()
  })

  it('titles itself by the number of tunes for a one-tune selection', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    renderIonic(<ListPicker open userTuneIds={[userTuneId]} onClose={() => {}} />, { db })
    await expect.element(page.getByText('Add 1 tune to a list')).toBeVisible()
  })

  it('reads a partial list as N of M in it', async () => {
    const db = openTestDb()
    const { userTuneId: a } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { userTuneId: b } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    await addToList(db, jam, a)
    renderIonic(<Host userTuneIds={[a, b]} />, { db })
    await expect.element(page.getByText('1 of 2 in it')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Tuesday jam/ })).toBeEnabled()
  })

  it('reads a full list as all in it and disables it', async () => {
    const db = openTestDb()
    const { userTuneId: a } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { userTuneId: b } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    await addToList(db, jam, a)
    await addToList(db, jam, b)
    renderIonic(<Host userTuneIds={[a, b]} />, { db })
    await expect.element(page.getByText('all in it')).toBeVisible()
    expect(page.getByRole('button', { name: /Tuesday jam/ }).elements()).toHaveLength(0)
    const row = document.querySelector('ion-item[aria-disabled="true"], ion-item[disabled]')
    expect(row?.textContent).toContain('Tuesday jam')
    expect(row?.textContent).toContain('all in it')
  })

  it('reads an empty list as none in it', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    await createList(db, 'Tuesday jam')
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await expect.element(page.getByText('none in it')).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Tuesday jam/ })).toBeEnabled()
  })

  it('adds only the tunes that were not already members', async () => {
    const db = openTestDb()
    const { userTuneId: a } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { userTuneId: b } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    await addToList(db, jam, a)
    const onAdded = vi.fn()
    renderIonic(<Host userTuneIds={[a, b]} onAdded={onAdded} />, { db })
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await vi.waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ added: 1 })),
    )
    const items = await db.list_items.where('list_id').equals(jam).toArray()
    expect(items.filter((item) => !item.deleted_at)).toHaveLength(2)
  })

  it('creates a list holding every selected tune', async () => {
    const db = openTestDb()
    const { userTuneId: a } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const { userTuneId: b } = await createTune(db, { title: 'Bill Cheatham' }, { status: 'known' })
    renderIonic(<Host userTuneIds={[a, b]} />, { db })
    await page.getByRole('button', { name: NEW_LIST_ITEM }).click()
    await page.getByLabelText(NEW_LIST_NAME_LABEL).fill('Violin club')
    await page.getByRole('button', { name: 'Create' }).click()
    await vi.waitFor(async () => {
      const [list] = await db.lists.toArray()
      expect(list?.name).toBe('Violin club')
      expect(await db.list_items.count()).toBe(2)
    })
    const items = await db.list_items.toArray()
    expect(new Set(items.map((item) => item.user_tune_id))).toEqual(new Set([a, b]))
  })

  it('does not offer the list it was told to exclude', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    await createList(db, 'Square dance set')
    renderIonic(<Host userTuneIds={[userTuneId]} excludeListId={jam} />, { db })
    await expect.element(page.getByText('Square dance set')).toBeVisible()
    expect(page.getByText('Tuesday jam').elements()).toHaveLength(0)
  })

  it('disables every row until membership has loaded', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    await createList(db, 'Tuesday jam')
    const wait = gate()
    membershipGate = wait.opened
    try {
      renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
      await expect.element(page.getByText('Tuesday jam')).toBeVisible()
      expect(page.getByText('none in it').elements()).toHaveLength(0)
      const row = document.querySelector('ion-item[aria-disabled="true"], ion-item[disabled]')
      expect(row?.textContent).toContain('Tuesday jam')
      wait.open()
      await expect.element(page.getByText('none in it')).toBeVisible()
      await expect.element(page.getByRole('button', { name: /Tuesday jam/ })).toBeEnabled()
    } finally {
      membershipGate = undefined
    }
  })

  it('refuses a whitespace-only new list name', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'known' })
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await page.getByRole('button', { name: NEW_LIST_ITEM }).click()
    const field = page.getByLabelText(NEW_LIST_NAME_LABEL)
    await field.fill('   ')
    await expect.element(page.getByRole('button', { name: 'Create' })).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    expect(bulk.createListWithTunes).not.toHaveBeenCalled()
    await expect.element(field).toBeVisible()
    expect(await db.lists.count()).toBe(0)
  })

  it('cannot pick a list the tune is already in', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(
      db,
      { title: 'Angeline the Baker' },
      { status: 'known' },
    )
    const set = await createList(db, 'Square dance set')
    await addToList(db, set, userTuneId)
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await expect.element(page.getByText('all in it')).toBeVisible()
    expect(page.getByRole('button', { name: /Square dance set/ }).elements()).toHaveLength(0)
    const row = document.querySelector('ion-item[aria-disabled="true"], ion-item[disabled]')
    expect(row?.textContent).toContain('Square dance set')
    expect(row?.textContent).toContain('all in it')
  })

  it('picks a list once from two clicks in the same tick', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'June Apple' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await expect.element(page.getByText('Add to a list')).toBeVisible()
    const item = page.getByRole('button', { name: /Tuesday jam/ }).element()
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }))
    await vi.waitFor(async () =>
      expect(await db.list_items.where('list_id').equals(jam).count()).toBe(1),
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await db.list_items.where('list_id').equals(jam).count()).toBe(1)
  })

  it('creates one list from two Create clicks in the same tick', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(
      db,
      { title: 'Whiskey Before Breakfast' },
      {
        status: 'known',
      },
    )
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await page.getByRole('button', { name: NEW_LIST_ITEM }).click()
    await page.getByLabelText(NEW_LIST_NAME_LABEL).fill('Fiddlers convention')
    const create = document.querySelector('ion-button[slot="end"]')!
    create.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    create.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await vi.waitFor(async () => expect(await db.lists.count()).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await db.lists.count()).toBe(1)
  })

  it('reports the close once when a pick succeeds', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Old Joe Clark' }, { status: 'known' })
    await createList(db, 'Tuesday jam')
    const onClose = vi.fn()
    renderIonic(<Host userTuneIds={[userTuneId]} onClose={onClose} />, { db })
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await sheetDismissed()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports the close once on Cancel', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(
      db,
      { title: 'Blackberry Blossom' },
      {
        status: 'known',
      },
    )
    const onClose = vi.fn()
    renderIonic(<Host userTuneIds={[userTuneId]} onClose={onClose} />, { db })
    await expect.element(page.getByText('Add to a list')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await sheetDismissed()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('lets a failed add be tried again', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Sail Away Ladies' }, { status: 'known' })
    const jam = await createList(db, 'Tuesday jam')
    vi.mocked(bulk.addTunesToList).mockRejectedValueOnce(new Error('Could not add'))
    renderIonic(<Host userTuneIds={[userTuneId]} />, { db })
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not add')
    await page.getByRole('button', { name: /Tuesday jam/ }).click()
    await vi.waitFor(async () =>
      expect(await db.list_items.where('list_id').equals(jam).count()).toBe(1),
    )
  })

  it('clears the new list form when reopened', async () => {
    const db = openTestDb()
    const { userTuneId } = await createTune(db, { title: 'Forked Deer' }, { status: 'known' })
    function ReopenHost() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <ListPicker
            open={open}
            userTuneIds={[userTuneId]}
            title="Add to a list"
            onClose={() => setOpen(false)}
          />
        </>
      )
    }
    renderIonic(<ReopenHost />, { db })
    await page.getByRole('button', { name: NEW_LIST_ITEM }).click()
    await page.getByLabelText(NEW_LIST_NAME_LABEL).fill('Half typed name')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await sheetDismissed()
    await page.getByRole('button', { name: 'Reopen' }).click()
    await expect.element(page.getByRole('button', { name: NEW_LIST_ITEM })).toBeVisible()
    expect(page.getByLabelText(NEW_LIST_NAME_LABEL).elements()).toHaveLength(0)
  })
})
