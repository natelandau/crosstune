import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp, renderWithProviders } from '../../test/render'
import { ListsScreen } from './ListsScreen'

let db: CrosstuneDb
let listId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  const { userSongId } = await createSong(db, { title: 'X' }, { status: 'known' })
  await addToList(db, listId, userSongId)
})

afterEach(async () => {
  await db.delete()
})

describe('ListsScreen', () => {
  it('shows lists with counts and creates a new one', async () => {
    renderWithProviders(<ListsScreen />, { db })
    expect(await screen.findByRole('link', { name: /Tuesday jam/ })).toHaveTextContent(
      '1 song · Edited today',
    )
    expect(screen.getByText('Tuesday jam')).toHaveClass('truncate', 'text-title')
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), 'Square dance')
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))
    expect(await screen.findByRole('link', { name: /Square dance/ })).toBeInTheDocument()
    await waitFor(async () => expect(await db.lists.count()).toBe(2))
  })

  it('edits a list from its row and returns to Lists on cancel', async () => {
    const { router } = renderApp({ db, path: '/lists' })
    await screen.findByRole('link', { name: /Tuesday jam/ })
    await userEvent.click(screen.getByRole('button', { name: 'Edit Tuesday jam' }))
    expect(await screen.findByRole('textbox', { name: 'List name' })).toHaveValue('Tuesday jam')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/lists'))
  })

  it('deletes a list from its row after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithProviders(<ListsScreen />, { db })
    await screen.findByRole('link', { name: /Tuesday jam/ })
    await userEvent.click(screen.getByRole('button', { name: 'Delete Tuesday jam' }))
    expect(confirm).toHaveBeenCalledWith('Delete "Tuesday jam"?')
    await waitFor(() => expect(screen.queryByRole('link', { name: /Tuesday jam/ })).toBeNull())
    expect((await db.lists.get(listId))?.deleted_at).not.toBeNull()
  })

  it('keeps a list when delete is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithProviders(<ListsScreen />, { db })
    await screen.findByRole('link', { name: /Tuesday jam/ })
    await userEvent.click(screen.getByRole('button', { name: 'Delete Tuesday jam' }))
    expect(screen.getByRole('link', { name: /Tuesday jam/ })).toBeInTheDocument()
    expect((await db.lists.get(listId))?.deleted_at).toBeNull()
  })
})
