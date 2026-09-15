import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeItems, addToList, createList } from '../../commands/lists'
import { createSong, setArchived } from '../../commands/songs'
import { CLICK_GUARD_MS } from '../../components/swipe'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createSong(db, { title: "Bonaparte's Retreat", key: 'D' }, { status: 'learning' })
  await createSong(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'known' })
  await createSong(db, { title: "Elzic's Farewell", key: 'A' }, { status: 'want_to_learn' })
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))
  await db.delete()
})

const selectButton = () => screen.getByRole('button', { name: 'Select' })
const checkbox = (title: string) => screen.getByRole('checkbox', { name: title })
const toolbar = () => screen.getByRole('toolbar', { name: 'Selected songs' })

// A song archived beforehand is hidden by the default filter, so a test covering one
// must wait on a title that still renders.
async function enterSelection(anchor = 'Cluck Old Hen') {
  const view = renderApp({ db })
  await screen.findByRole('link', { name: new RegExp(anchor) })
  await userEvent.click(selectButton())
  await screen.findByText('0 selected')
  return view
}

describe('catalog selection', () => {
  it('enters from Select, focuses the first checkbox, and leaves from Cancel', async () => {
    const { router } = await enterSelection()
    expect(router.state.location.search).toEqual({ select: true })
    await waitFor(() => expect(checkbox("Bonaparte's Retreat")).toHaveFocus())
    expect(screen.queryByRole('link', { name: /Cluck Old Hen/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selection' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.history.canGoBack()).toBe(false)
    await waitFor(() => expect(selectButton()).toHaveFocus())
  })

  it('leaves selection mode on Back', async () => {
    const { router } = await enterSelection()
    router.history.back()
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
  })

  it('leaves selection mode on Escape', async () => {
    const { router } = await enterSelection()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('toggles rows by tap, counts them, and selects all', async () => {
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    expect(checkbox('Cluck Old Hen')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  it('selects a range with Shift', async () => {
    await enterSelection()
    const user = userEvent.setup()
    await user.click(screen.getByText("Bonaparte's Retreat"))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByText("Elzic's Farewell"))
    await user.keyboard('{/Shift}')
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('drops songs a filter hides from the selection', async () => {
    await enterSelection()
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Known' }))
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
  })

  it('disables the actions until a song is selected', async () => {
    await enterSelection()
    for (const name of ['Status', 'Edit', 'Add to list', 'More']) {
      expect(within(toolbar()).getByRole('button', { name })).toBeDisabled()
    }
  })

  it('hides the add song button while selecting', async () => {
    await enterSelection()
    expect(screen.queryByRole('link', { name: 'Add song' })).toBeNull()
  })

  it('enters with a row selected from a long-press', async () => {
    const { router } = renderApp({ db })
    const title = await screen.findByText('Cluck Old Hen')
    fireEvent.pointerDown(title, {
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      button: 0,
      pointerId: 1,
    })
    await waitFor(() => expect(router.state.location.search).toEqual({ select: true }), {
      timeout: 3000,
    })
    fireEvent.pointerUp(screen.getByText('Cluck Old Hen'), { isPrimary: true, pointerId: 1 })
    expect(checkbox('Cluck Old Hen')).toBeChecked()
    await waitFor(() => expect(checkbox('Cluck Old Hen')).toHaveFocus())
  })

  it('releases the click guard after entering selection by long-press', async () => {
    const { router } = renderApp({ db })
    const title = await screen.findByText('Cluck Old Hen')
    fireEvent.pointerDown(title, {
      clientX: 20,
      clientY: 20,
      isPrimary: true,
      button: 0,
      pointerId: 1,
    })
    await waitFor(() => expect(router.state.location.search).toEqual({ select: true }), {
      timeout: 3000,
    })
    // Entering selection swaps the row's title from a link to plain text, replacing the DOM
    // node `title` pointed to, so the release must land on the row freshly queried now.
    fireEvent.pointerUp(screen.getByText('Cluck Old Hen'), { isPrimary: true, pointerId: 1 })
    // The long-press armed a trailing-click guard on window; give it its release window
    // before the click below, the same way the file's own afterEach does between tests.
    await new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))
    await userEvent.click(screen.getByText("Bonaparte's Retreat"))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selection' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('selects all visible songs with Ctrl-A while a checkbox has focus', async () => {
    await enterSelection()
    checkbox("Bonaparte's Retreat").focus()
    await userEvent.keyboard('{Control>}a{/Control}')
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('selects all visible songs with Meta-A while a checkbox has focus', async () => {
    await enterSelection()
    checkbox("Bonaparte's Retreat").focus()
    await userEvent.keyboard('{Meta>}a{/Meta}')
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('mounts the sheets only while selecting', async () => {
    renderApp({ db })
    await screen.findByRole('link', { name: /Cluck Old Hen/ })
    expect(document.querySelector('dialog')).toBeNull()
    await userEvent.click(selectButton())
    await screen.findByText('0 selected')
    expect(document.querySelectorAll('dialog')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel selection' }))
    await screen.findByRole('link', { name: /Cluck Old Hen/ })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('keeps a closing sheet mounted until its exit transition ends', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Status' }))
    const sheet = screen.getByRole('dialog', { name: 'Set status for 1 song' })
    await userEvent.click(within(sheet).getByRole('button', { name: /^Learning/ }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(sheet).toBeInTheDocument()
    fireEvent.transitionEnd(sheet)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('closes an open sheet when Back leaves selection', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Status' }))
    const sheet = screen.getByRole('dialog', { name: 'Set status for 1 song' })
    router.history.back()
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await waitFor(() => expect(sheet).not.toHaveAttribute('open'))
    fireEvent.transitionEnd(sheet)
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('stays on the catalog when Enter is pressed in the search box while selecting', async () => {
    const { router } = await enterSelection()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search songs' }), 'Cluck{Enter}')
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.search).toEqual({ select: true })
    expect(screen.getByRole('searchbox', { name: 'Search songs' })).not.toHaveFocus()
  })

  it('offers no add or open links for the search while selecting', async () => {
    await enterSelection()
    const search = screen.getByRole('searchbox', { name: 'Search songs' })
    await userEvent.type(search, 'Cluck')
    await waitFor(() => expect(screen.queryByText("Elzic's Farewell")).toBeNull())
    expect(screen.queryByRole('link', { name: /Add/ })).toBeNull()
    await userEvent.clear(search)
    await userEvent.type(search, 'Nothing like it')
    await screen.findByText('No song called "Nothing like it"')
    expect(screen.queryByRole('link', { name: /Add/ })).toBeNull()
  })

  it('keeps selection mode when Escape fires from the search box', async () => {
    const { router } = await enterSelection()
    screen.getByRole('searchbox', { name: 'Search songs' }).focus()
    await userEvent.keyboard('{Escape}')
    expect(router.state.location.search).toEqual({ select: true })
  })
})

const statusOf = async (title: string) => {
  const song = (await db.songs.toArray()).find((s) => s.title === title)!
  return (await db.user_songs.where('song_id').equals(song.id).first())!
}

describe('catalog bulk status and archive', () => {
  it('sets the status of every selected song, ends selection, and undoes', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText("Bonaparte's Retreat"))
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Status' }))
    const sheet = screen.getByRole('dialog', { name: 'Set status for 2 songs' })
    expect(within(sheet).getByRole('button', { name: /^Learning/ })).toHaveTextContent('1 now')
    await userEvent.click(within(sheet).getByRole('button', { name: /^Want to learn/ }))
    await waitFor(async () =>
      expect((await statusOf('Cluck Old Hen')).status).toBe('want_to_learn'),
    )
    expect((await statusOf("Bonaparte's Retreat")).status).toBe('want_to_learn')
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    const toast = screen.getByText('Set 2 songs to Want to learn')
    expect(toast).toHaveAttribute('role', 'status')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await statusOf('Cluck Old Hen')).status).toBe('known'))
    expect((await statusOf("Bonaparte's Retreat")).status).toBe('learning')
  })

  it('returns to selection with the same songs when the status sheet is cancelled', async () => {
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Status' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Set status for 1 song' })).getByRole('button', {
        name: 'Cancel',
      }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('archives from More and undoes', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(screen.getByText("Elzic's Farewell"))
    // jsdom cannot open a popover, so the menu's buttons are reached while hidden.
    await userEvent.click(screen.getByRole('button', { name: 'Archive 2 songs', hidden: true }))
    await waitFor(async () => expect((await statusOf('Cluck Old Hen')).archived_at).not.toBeNull())
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Archived 2 songs')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Cluck Old Hen')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Cluck Old Hen')).toBeInTheDocument()
  })

  it('offers Archive and Unarchive together for a mixed selection', async () => {
    await setArchived(db, (await statusOf('Cluck Old Hen')).id, true)
    await enterSelection("Elzic's Farewell")
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await userEvent.click(await screen.findByText('Cluck Old Hen'))
    await userEvent.click(screen.getByText("Elzic's Farewell"))
    expect(screen.getByRole('button', { name: 'Archive 1 song', hidden: true })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Unarchive 1 song', hidden: true }),
    ).toBeInTheDocument()
  })

  it('unarchives from More and undoes', async () => {
    const cluck = (await statusOf('Cluck Old Hen')).id
    await setArchived(db, cluck, true)
    const { router } = await enterSelection("Elzic's Farewell")
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await userEvent.click(await screen.findByText('Cluck Old Hen'))
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive 1 song', hidden: true }))
    await waitFor(async () => expect((await statusOf('Cluck Old Hen')).archived_at).toBeNull())
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Unarchived 1 song')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await statusOf('Cluck Old Hen')).archived_at).not.toBeNull())
  })

  it('keeps the selection and shows the error when a write fails', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Disk full') as never)
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Status' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Set status for 1 song' })).getByRole('button', {
        name: /^Learning/,
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
    expect(router.state.location.search).toEqual({ select: true })
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})

describe('catalog bulk edit', () => {
  it('sets a violin tuning on every selected song and undoes', async () => {
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(screen.getByText("Elzic's Farewell"))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Edit' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit 2 songs' })
    await userEvent.type(
      within(sheet).getByRole('combobox', { name: 'Violin tuning' }),
      'Cross A (AEAE)',
    )
    await userEvent.click(within(sheet).getByRole('button', { name: 'Apply to 2' }))
    await waitFor(async () => {
      const tunings = (await db.songs.toArray()).map((song) => [song.title, song.violin_tuning])
      expect(tunings).toEqual(
        expect.arrayContaining([
          ['Cluck Old Hen', 'Cross A (AEAE)'],
          ["Elzic's Farewell", 'Cross A (AEAE)'],
          ["Bonaparte's Retreat", null],
        ]),
      )
    })
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Edited 2 songs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () =>
      expect((await db.songs.toArray()).every((song) => song.violin_tuning === null)).toBe(true),
    )
  })

  it('opens the edit sheet with fresh fields each time', async () => {
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Genre' }), 'Old-time')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('')
  })
})

describe('catalog add to list', () => {
  it('adds the selected songs to a list and undoes', async () => {
    const listId = await createList(db, 'Tuesday jam')
    const { router } = await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(screen.getByText("Elzic's Farewell"))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Add to list' }))
    const sheet = screen.getByRole('dialog', { name: 'Add 2 songs to a list' })
    const list = within(sheet).getByRole('button', { name: /Tuesday jam/ })
    await waitFor(() => expect(list).toBeEnabled())
    await userEvent.click(list)
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(2))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.getByText('Added 2 songs to Tuesday jam')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(0))
  })

  it('reports only the songs actually added when one is already a member', async () => {
    const listId = await createList(db, 'Tuesday jam')
    await addToList(db, listId, (await statusOf('Cluck Old Hen')).id)
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(screen.getByText("Elzic's Farewell"))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Add to list' }))
    const sheet = screen.getByRole('dialog', { name: 'Add 2 songs to a list' })
    const list = within(sheet).getByRole('button', { name: /Tuesday jam/ })
    await waitFor(() => expect(list).toHaveTextContent('1 of 2 in it'))
    await userEvent.click(list)
    await waitFor(async () => expect(await activeItems(db, listId)).toHaveLength(2))
    expect(screen.getByText('Added 1 song to Tuesday jam')).toBeInTheDocument()
  })

  it('creates a new list holding the selected songs', async () => {
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Add to list' }))
    await userEvent.click(screen.getByRole('button', { name: 'New list…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), 'Clifftop')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Created Clifftop with 1 song')).toBeInTheDocument()
    const lists = await db.lists.toArray()
    expect(lists.map((l) => l.name)).toEqual(['Clifftop'])
    expect(await activeItems(db, lists[0]!.id)).toHaveLength(1)
  })

  it('deletes the new list on Undo', async () => {
    await enterSelection()
    await userEvent.click(screen.getByText('Cluck Old Hen'))
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Add to list' }))
    await userEvent.click(screen.getByRole('button', { name: 'New list…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New list name' }), 'Clifftop')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Created Clifftop with 1 song')).toBeInTheDocument()
    const [list] = await db.lists.toArray()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await db.lists.get(list!.id))?.deleted_at).not.toBeNull())
    expect(await activeItems(db, list!.id)).toHaveLength(0)
  })
})
