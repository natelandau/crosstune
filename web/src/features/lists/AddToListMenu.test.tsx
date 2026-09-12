import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activeItems, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { AddToListMenu } from './AddToListMenu'

let db: CrosstuneDb
let listId: string
let userSongId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  userSongId = (await createSong(db, { title: 'X' }, { status: 'known' })).userSongId
})

afterEach(async () => {
  await db.delete()
})

describe('AddToListMenu', () => {
  it('toggles membership per list', async () => {
    renderWithProviders(<AddToListMenu userSongId={userSongId} />, { db })
    const box = await screen.findByRole('checkbox', { name: 'Tuesday jam' })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(1))
    await userEvent.click(box)
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(0))
  })
})
