import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import type { CatalogEntry } from '../catalog/filters'
import { ListPickerSheet } from './ListPickerSheet'

let db: CrosstuneDb
let entries: CatalogEntry[]
let full: string
let partial: string
let empty: string

async function entry(title: string): Promise<CatalogEntry> {
  const { songId, userSongId } = await createSong(db, { title }, { status: 'known' })
  return { song: (await db.songs.get(songId))!, userSong: (await db.user_songs.get(userSongId))! }
}

beforeEach(async () => {
  db = openTestDb()
  entries = [await entry('Angeline'), await entry('Bill Cheatham')]
  empty = await createList(db, 'Tuesday jam')
  partial = await createList(db, 'Square dance set')
  full = await createList(db, 'Clifftop')
  await addToList(db, partial, entries[0]!.userSong.id)
  for (const e of entries) await addToList(db, full, e.userSong.id)
})

afterEach(async () => {
  await db.delete()
})

function renderPicker(excludeListId?: string) {
  const onAdd = vi.fn()
  const onCreate = vi.fn()
  renderWithProviders(
    <ListPickerSheet
      open
      entries={entries}
      excludeListId={excludeListId}
      onClose={vi.fn()}
      onAdd={onAdd}
      onCreate={onCreate}
    />,
    { db },
  )
  return { onAdd, onCreate }
}

describe('ListPickerSheet', () => {
  it('shows how many selected songs each list has, and disables a full one', async () => {
    renderPicker()
    expect(await screen.findByRole('dialog', { name: 'Add 2 songs to a list' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Tuesday jam/ })).toHaveTextContent('none in it'),
    )
    expect(screen.getByRole('button', { name: /Square dance set/ })).toHaveTextContent(
      '1 of 2 in it',
    )
    expect(screen.getByRole('button', { name: /Clifftop/ })).toHaveTextContent('all in it')
    expect(screen.getByRole('button', { name: /Clifftop/ })).toBeDisabled()
  })

  it('adds to a list when clicked', async () => {
    const { onAdd } = renderPicker()
    const button = await screen.findByRole('button', { name: /Square dance set/ })
    await waitFor(() => expect(button).toHaveTextContent('1 of 2 in it'))
    await userEvent.click(button)
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: partial }))
  })

  it('leaves out the list being viewed', async () => {
    renderPicker(empty)
    await screen.findByRole('button', { name: /Clifftop/ })
    expect(screen.queryByRole('button', { name: /Tuesday jam/ })).toBeNull()
  })

  it('creates a new list from a name', async () => {
    const { onCreate } = renderPicker()
    await userEvent.click(await screen.findByRole('button', { name: 'New list…' }))
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'New list name' })).toHaveFocus()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'New list name' }),
      'Fiddlers convention',
    )
    await userEvent.click(create)
    expect(onCreate).toHaveBeenCalledWith('Fiddlers convention')
  })

  it('keeps Create disabled for a whitespace-only name', async () => {
    renderPicker()
    await userEvent.click(await screen.findByRole('button', { name: 'New list…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), '   ')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
