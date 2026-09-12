import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { ListsScreen } from './ListsScreen'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  const listId = await createList(db, 'Tuesday jam')
  const { userSongId } = await createSong(db, { title: 'X' }, { status: 'known' })
  await addToList(db, listId, userSongId)
})

afterEach(async () => {
  await db.delete()
})

describe('ListsScreen', () => {
  it('shows lists with counts and creates a new one', async () => {
    renderWithProviders(<ListsScreen />, { db })
    expect(await screen.findByRole('link', { name: /Tuesday jam/ })).toHaveTextContent('1 song')
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), 'Square dance')
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }))
    expect(await screen.findByRole('link', { name: /Square dance/ })).toBeInTheDocument()
    await waitFor(async () => expect(await db.lists.count()).toBe(2))
  })
})
