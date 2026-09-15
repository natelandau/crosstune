import { createMemoryHistory } from '@tanstack/react-router'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import { createSong } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb
let listId: string

beforeEach(async () => {
  db = openTestDb()
  listId = await createList(db, 'Tuesday jam')
})

afterEach(async () => {
  await db.delete()
})

function renderListRoute(
  path = `/lists/${listId}`,
  history = createMemoryHistory({ initialEntries: [path] }),
) {
  return renderApp({ db, history })
}

describe('ListPage', () => {
  it('opens a rename form seeded with the name from ?edit=true', async () => {
    renderListRoute(`/lists/${listId}?edit=true`)
    expect(await screen.findByRole('textbox', { name: 'List name' })).toHaveValue('Tuesday jam')
  })

  it('leaves no duplicate history entry behind after Rename and Cancel', async () => {
    const { router } = renderListRoute()
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ edit: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe(`/lists/${listId}`)
    expect(router.history.canGoBack()).toBe(false)
  })

  it('stays on the list when Cancel is tapped twice before the form closes', async () => {
    const history = createMemoryHistory({ initialEntries: ['/lists', `/lists/${listId}`] })
    const { router } = renderListRoute(`/lists/${listId}`, history)
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ edit: true }))
    // A browser goes back on a later popstate; memory history would go back at once and hide a double pop.
    const back = router.history.back.bind(router.history)
    vi.spyOn(router.history, 'back').mockImplementation(() => void setTimeout(back, 0))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancel)
    fireEvent.click(cancel)
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.state.location.pathname).toBe(`/lists/${listId}`)
    expect(await screen.findByRole('heading', { name: 'Tuesday jam' })).toBeInTheDocument()
  })

  it('replaces to the clean URL on cancel when the edit entry it pushed has nothing behind it', async () => {
    const path = `/lists/${listId}?edit=true`
    const history = createMemoryHistory({ initialEntries: [path] })
    // A reload into edit mode as the first entry keeps the flag but leaves no view entry to go back to.
    history.replace(path, { editPushed: true })
    const { router } = renderListRoute(path, history)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe(`/lists/${listId}`)
    expect(router.history.canGoBack()).toBe(false)
    expect(await screen.findByRole('heading', { name: 'Tuesday jam' })).toBeInTheDocument()
  })

  it('edits a song from its row and returns to the list on cancel', async () => {
    const { userSongId } = await createSong(db, { title: 'Angeline' }, { status: 'known' })
    await addToList(db, listId, userSongId)
    const { router } = renderListRoute()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Angeline' }))
    expect(await screen.findByRole('heading', { name: 'Edit song' })).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ edit: true })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/lists/${listId}`))
  })

  it('offers no delete while renaming', async () => {
    renderListRoute(`/lists/${listId}?edit=true`)
    await screen.findByRole('textbox', { name: 'List name' })
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull()
  })

  it('saves from a deep-linked rename and replaces to the clean URL', async () => {
    const { router } = renderListRoute(`/lists/${listId}?edit=true`)
    const input = await screen.findByRole('textbox', { name: 'List name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Thursday jam')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Thursday jam' })).toBeInTheDocument()
    expect(router.state.location.search).toEqual({})
    expect(router.state.location.pathname).toBe(`/lists/${listId}`)
  })
})
