import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { ListDetail } from './ListDetail'

let db: CrosstuneDb
let listId: string
let a: string
let b: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
  a = (await createSong(db, { title: 'Angeline', key: 'D' }, { status: 'known' })).userSongId
  b = (await createSong(db, { title: 'Bill Cheatham', key: 'A' }, { status: 'known' })).userSongId
  await createSong(db, { title: 'Cumberland Gap', key: 'G' }, { status: 'learning' })
  await addToList(db, listId, a)
  await addToList(db, listId, b)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(async () => {
  await db.delete()
})

describe('ListDetail', () => {
  it('renders items in order and moves them', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Angeline')
    await userEvent.click(screen.getByRole('button', { name: 'Move Angeline down' }))
    await waitFor(async () => {
      const ordered = await activeItems(db, listId)
      expect(ordered.map((i) => i.user_song_id)).toEqual([b, a])
    })
  })

  it('shows each song as a two-row item with its position, key, and status', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const items = await screen.findAllByRole('listitem')
    expect(within(items[1]!).getByText('2')).toBeInTheDocument()
    const link = within(items[0]!).getByRole('link', { name: /Angeline/ })
    expect(link).toHaveTextContent('Key D')
    expect(link).toHaveTextContent('Known')
  })

  it('removes a song from its row swipe action', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    await screen.findAllByRole('listitem')
    expect(screen.getByRole('button', { name: 'Edit Angeline' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Angeline' }))
    await waitFor(async () =>
      expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([b]),
    )
  })

  it('adds a song through the picker and removes one', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    await screen.findAllByRole('listitem')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Add a song' }), 'cumber')
    await userEvent.click(await screen.findByRole('button', { name: 'Add Cumberland Gap' }))
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Angeline' }))
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(2))
  })

  it('asks for edit mode from Rename', async () => {
    const onEditChange = vi.fn()
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={onEditChange} onDeleted={() => {}} />,
      { db },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    expect(onEditChange).toHaveBeenCalledWith(true)
  })

  it('renames in edit mode and leaves it on save', async () => {
    const onEditChange = vi.fn()
    renderWithProviders(
      <ListDetail listId={listId} edit onEditChange={onEditChange} onDeleted={() => {}} />,
      { db },
    )
    const input = await screen.findByRole('textbox', { name: 'List name' })
    expect(input).toHaveValue('Tuesday jam')
    await userEvent.clear(input)
    await userEvent.type(input, 'Thursday jam')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await db.lists.get(listId))?.name).toBe('Thursday jam'))
    expect(onEditChange).toHaveBeenCalledWith(false)
  })

  it('hides Delete list in edit mode', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    await screen.findByRole('textbox', { name: 'List name' })
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull()
  })

  it('deletes the list', async () => {
    const onDeleted = vi.fn()
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={onDeleted} />,
      { db },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Delete list' }))
    await waitFor(async () => expect((await db.lists.get(listId))?.deleted_at).not.toBeNull())
    expect(onDeleted).toHaveBeenCalled()
  })
})
