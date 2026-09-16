import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createSong, setArchived } from '../../commands/songs'
import { CLICK_GUARD_MS } from '../../components/swipe'
import { LONG_PRESS_MS } from '../../components/useLongPress'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb
let listId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  await createList(db, 'Square dance set')
  for (const title of ['Sail Away Ladies', 'Big Sciota', 'Old Molly Hare']) {
    const { userSongId } = await createSong(db, { title }, { status: 'known' })
    await addToList(db, listId, userSongId)
  }
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))
  await db.delete()
})

const toolbar = () => screen.getByRole('toolbar', { name: 'Selected songs' })

async function userSongIdFor(title: string): Promise<string> {
  const song = (await db.songs.toArray()).find((s) => s.title === title)!
  return (await db.user_songs.where('song_id').equals(song.id).first())!.id
}

async function enterListSelection() {
  const view = renderApp({ db, path: `/lists/${listId}` })
  await screen.findByRole('heading', { name: 'Tuesday jam' })
  await userEvent.click(screen.getByRole('button', { name: 'Select' }))
  await screen.findByText('0 selected')
  return view
}

describe('list selection', () => {
  it('hides the handles, picker, and delete while selecting, and keeps positions', async () => {
    const { router } = await enterListSelection()
    expect(router.state.location.search).toEqual({ select: true })
    expect(screen.queryByRole('button', { name: 'Reorder Big Sciota' })).toBeNull()
    expect(screen.queryByRole('searchbox', { name: 'Add a song' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    const items = screen.getAllByRole('listitem')
    expect(within(items[1]!).getByText('2')).toBeInTheDocument()
    expect(within(items[1]!).getByRole('checkbox', { name: 'Big Sciota' })).toBeInTheDocument()
  })

  it('removes the selected songs from the list and undoes', async () => {
    const { router } = await enterListSelection()
    await userEvent.click(screen.getByText('Sail Away Ladies'))
    await userEvent.click(screen.getByText('Old Molly Hare'))
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Remove 2 from list', hidden: true }),
    )
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(1))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Removed 2 songs from Tuesday jam')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(3))
    await waitFor(() => {
      const items = screen.getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('Sail Away Ladies')
      expect(items[1]).toHaveTextContent('Big Sciota')
      expect(items[2]).toHaveTextContent('Old Molly Hare')
    })
  })

  it('keeps the selection and shows the error when Remove fails', async () => {
    const { router } = await enterListSelection()
    await userEvent.click(screen.getByText('Sail Away Ladies'))
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Disk full') as never)
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Remove 1 from list', hidden: true }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    expect(router.state.location.search).toEqual({ select: true })
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('drops the count when Show archived turns off during selection', async () => {
    await setArchived(db, await userSongIdFor('Old Molly Hare'), true)
    await enterListSelection()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await screen.findByText('Old Molly Hare')
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await waitFor(() => expect(screen.getByText('2 selected')).toBeInTheDocument())
  })

  it('focuses the page after removing every visible song', async () => {
    await enterListSelection()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Remove 3 from list', hidden: true }),
    )
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(0))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')))
  })

  it('does not offer the current list in Add to list', async () => {
    await enterListSelection()
    await userEvent.click(screen.getByText('Big Sciota'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Add to list' }))
    const sheet = screen.getByRole('dialog', { name: 'Add 1 song to a list' })
    expect(
      await within(sheet).findByRole('button', { name: /Square dance set/ }),
    ).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Tuesday jam/ })).toBeNull()
  })

  it('hides Select while renaming', async () => {
    renderApp({ db, path: `/lists/${listId}?edit=true` })
    await screen.findByRole('textbox', { name: 'List name' })
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull()
  })

  it('does not start selecting from a long-press while renaming', async () => {
    const { router } = renderApp({ db, path: `/lists/${listId}?edit=true` })
    const title = await screen.findByText('Big Sciota')
    fireEvent.pointerDown(title, {
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      button: 0,
      pointerId: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 50))
    fireEvent.pointerUp(title, { isPrimary: true, pointerId: 1 })
    expect(router.state.location.search).toEqual({ edit: true })
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('shows the rename form and no selection bar when edit and select are both set', async () => {
    renderApp({ db, path: `/lists/${listId}?edit=true&select=true` })
    await screen.findByRole('textbox', { name: 'List name' })
    expect(screen.queryByRole('toolbar', { name: 'Selected songs' })).toBeNull()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('shows the handles again after leaving selection mode', async () => {
    await enterListSelection()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selection' }))
    expect(await screen.findByRole('button', { name: 'Reorder Big Sciota' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Add a song' })).toBeInTheDocument()
  })

  it('closes a swiped-open row on entering, so it stays closed after leaving', async () => {
    renderApp({ db, path: `/lists/${listId}` })
    const title = await screen.findByText('Big Sciota')
    const removeAction = () =>
      screen.getByRole('button', { name: 'Remove Big Sciota', hidden: true })
    fireEvent.pointerDown(title, {
      clientX: 300,
      clientY: 100,
      isPrimary: true,
      button: 0,
      pointerId: 1,
    })
    for (const dx of [-20, -80, -140]) {
      fireEvent.pointerMove(document, {
        clientX: 300 + dx,
        clientY: 100,
        isPrimary: true,
        pointerId: 1,
      })
    }
    fireEvent.pointerUp(document, { isPrimary: true, button: 0, pointerId: 1 })
    await waitFor(() => expect(removeAction().closest('[inert]')).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    await screen.findByText('0 selected')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selection' }))
    await screen.findByRole('button', { name: 'Reorder Big Sciota' })
    expect(removeAction().closest('[inert]')).not.toBeNull()
  })
})
