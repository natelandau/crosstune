import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createSong, setArchived } from '../../commands/songs'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { ListDetail } from './ListDetail'
import { META_LIST_SHOW_ARCHIVED } from './useListShowArchived'

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

// jsdom hides an unopened popover but cannot open one, so the menu's buttons are reached while hidden.
const moveButton = (row: HTMLElement, name: string) =>
  within(row).getByRole('button', { name, hidden: true })

describe('ListDetail', () => {
  it('renders items in order and moves one from its handle menu', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const items = await screen.findAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Angeline')
    expect(within(items[0]!).getByRole('button', { name: 'Reorder Angeline' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Angeline up' })).toBeNull()
    await userEvent.click(moveButton(items[0]!, 'Move down'))
    await waitFor(async () => {
      const ordered = await activeItems(db, listId)
      expect(ordered.map((i) => i.user_song_id)).toEqual([b, a])
    })
    expect(await screen.findByText('Moved Angeline to position 2 of 2')).toHaveAttribute(
      'role',
      'status',
    )
  })

  it('keeps focus on the handle of a song moved down from its menu', async () => {
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const items = await screen.findAllByRole('listitem')
    await userEvent.click(moveButton(items[0]!, 'Move down'))
    await waitFor(() => expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Angeline'))
    expect(screen.getByRole('button', { name: 'Reorder Angeline' })).toHaveFocus()
  })

  it('moves a song to the top or bottom, and disables moves that go nowhere', async () => {
    const c = (await createSong(db, { title: 'Cotton-Eyed Joe' }, { status: 'known' })).userSongId
    await addToList(db, listId, c)
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const items = await screen.findAllByRole('listitem')
    expect(moveButton(items[0]!, 'Move to top')).toBeDisabled()
    expect(moveButton(items[0]!, 'Move up')).toBeDisabled()
    expect(moveButton(items[2]!, 'Move down')).toBeDisabled()
    expect(moveButton(items[2]!, 'Move to bottom')).toBeDisabled()
    await userEvent.click(moveButton(items[2]!, 'Move to top'))
    await waitFor(async () =>
      expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([c, a, b]),
    )
    const reordered = await screen.findAllByRole('listitem')
    await waitFor(() => expect(reordered[0]).toHaveTextContent('Cotton-Eyed Joe'))
    await userEvent.click(moveButton(screen.getAllByRole('listitem')[0]!, 'Move to bottom'))
    await waitFor(async () =>
      expect((await activeItems(db, listId)).map((i) => i.user_song_id)).toEqual([a, b, c]),
    )
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

  it('hides archived songs until Show archived is on, and numbers only visible rows', async () => {
    await setArchived(db, a, true)
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const toggle = await screen.findByRole('checkbox', { name: 'Show archived' })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    const [only] = screen.getAllByRole('listitem')
    expect(only).toHaveTextContent('Bill Cheatham')
    expect(within(only!).getByText('1')).toBeInTheDocument()
    await userEvent.click(toggle)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(await getMeta(db, META_LIST_SHOW_ARCHIVED, null)).toBe(true)
  })

  it('says every song is archived when all of them are hidden', async () => {
    await setArchived(db, a, true)
    await setArchived(db, b, true)
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    expect(await screen.findByText('Every song here is archived')).toBeInTheDocument()
  })

  it('moves a song past a hidden archived song', async () => {
    const c = (await createSong(db, { title: 'Cotton-Eyed Joe' }, { status: 'known' })).userSongId
    await addToList(db, listId, c)
    await setArchived(db, b, true)
    renderWithProviders(
      <ListDetail listId={listId} edit={false} onEditChange={() => {}} onDeleted={() => {}} />,
      { db },
    )
    const [first] = await screen.findAllByRole('listitem')
    await userEvent.click(moveButton(first!, 'Move down'))
    await waitFor(async () => {
      const ordered = await activeItems(db, listId)
      expect(ordered.map((i) => i.user_song_id)).toEqual([b, c, a])
    })
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
