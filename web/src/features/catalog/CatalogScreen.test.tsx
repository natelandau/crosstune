import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSong, setArchived } from '../../commands/songs'
import { setInstruments } from '../../commands/settings'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp, renderWithProviders } from '../../test/render'
import { CatalogScreen } from './CatalogScreen'
import { META_CATALOG_FILTERS } from './filters'
import { readSearchQuery, writeSearchQuery } from './searchSession'

let db: CrosstuneDb
let soldiersJoy: string

beforeEach(async () => {
  db = openTestDb()
  soldiersJoy = (
    await createSong(
      db,
      { title: "Soldier's Joy", key: 'D', banjo_tuning: 'gDGBD' },
      { status: 'known' },
    )
  ).userSongId
  await createSong(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'learning' })
})

afterEach(async () => {
  await db.delete()
})

describe('CatalogScreen', () => {
  it('lists songs with their key and filters by search text', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cluck Old Hen/ })).toHaveTextContent('A')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search songs' }), 'cluck')
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    expect(screen.getByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
  })

  it('persists a status filter in the meta table', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: 'Learning' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ status: 'learning' })
  })

  it('offers a link to add a song', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    expect(await screen.findByRole('link', { name: 'Add song' })).toHaveAttribute(
      'href',
      '/songs/new',
    )
  })

  it('floats the add link above the dock, the safe area, and the player', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    const add = await screen.findByRole('link', { name: 'Add song' })
    expect(add).toHaveClass(
      'fixed',
      'z-10',
      'bottom-[calc(5rem+env(safe-area-inset-bottom)+var(--player-dock-offset,0px))]',
    )
  })

  it('leaves room below the last row for the add link', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    expect(screen.getByRole('list').parentElement).toHaveClass('pb-12')
  })

  it('offers a key rail and a sheet with only facets that have values for played instruments', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    const keys = screen.getByRole('group', { name: 'Key' })
    expect(within(keys).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(keys).getByRole('button', { name: 'D' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(sheet).queryByRole('group', { name: 'Mode' })).toBeNull()
    expect(within(sheet).queryByRole('group', { name: 'Violin tuning' })).toBeNull()
    expect(within(sheet).queryByRole('group', { name: 'Banjo tuning' })).toBeNull()
    await setInstruments(db, 'user_1', ['banjo'])
    expect(await within(sheet).findByRole('group', { name: 'Banjo tuning' })).toBeInTheDocument()
  })

  it('filters by key in one tap and shows the count', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    expect(screen.getByText('2 songs', { selector: '[aria-live]' })).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Key' })).getByRole('button', { name: 'A' }),
    )
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    // Scoped to the live region: the filter sheet stays mounted and carries the same count text.
    expect(screen.getByText('1 of 2 songs', { selector: '[aria-live]' })).toBeInTheDocument()
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ key: 'A' })
  })

  it('keeps the count row while every song in the catalog is archived', async () => {
    for (const userSong of await db.user_songs.toArray()) await setArchived(db, userSong.id, true)
    renderWithProviders(<CatalogScreen />, { db })
    expect(await screen.findByText('0 songs', { selector: '[aria-live]' })).toBeInTheDocument()
  })

  it('shows a sheet filter as a badge and a removable pill', async () => {
    await setInstruments(db, 'user_1', ['banjo'])
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    const filters = screen.getByRole('button', { name: 'Filters' })
    expect(filters).not.toHaveTextContent('1')
    await userEvent.click(filters)
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    await userEvent.click(
      within(await within(sheet).findByRole('group', { name: 'Banjo tuning' })).getByRole(
        'button',
        {
          name: 'gDGBD',
        },
      ),
    )
    await waitFor(() => expect(screen.queryByRole('link', { name: /Cluck Old Hen/ })).toBeNull())
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Filters, 1 set' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter gDGBD' }))
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ banjo_tuning: 'all' })
  })

  it('does not let a hidden facet narrow the catalog', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { banjo_tuning: 'gDGBD' })
    renderWithProviders(<CatalogScreen />, { db })
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Learning' }))
    await waitFor(async () =>
      expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({
        status: 'learning',
        banjo_tuning: 'all',
      }),
    )
  })

  it('does not wipe a stored facet with a click that lands before entries load', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { key: 'D' })
    renderWithProviders(<CatalogScreen />, { db })
    await userEvent.click(await screen.findByRole('button', { name: 'Known' }))
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ key: 'D' })
  })

  it('keeps the query for the session instead of in the meta table', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search songs' }), 'sold')
    await userEvent.click(screen.getByRole('button', { name: 'Known' }))
    await waitFor(async () =>
      expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ status: 'known' }),
    )
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).not.toHaveProperty('query')
    expect(readSearchQuery()).toBe('sold')
  })

  it('restores the session query and ignores one left in the meta table', async () => {
    await setMeta(db, META_CATALOG_FILTERS, { query: 'soldier' })
    writeSearchQuery('cluck')
    renderWithProviders(<CatalogScreen />, { db })
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search songs' })).toHaveValue('cluck')
    expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull()
  })
})

describe('CatalogScreen clear controls', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search songs' })

  it('clears only the search text with the clear search button', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Known' }))
    await userEvent.type(searchbox(), 'cluck')
    await userEvent.click(await screen.findByRole('button', { name: 'Clear search' }))
    expect(searchbox()).toHaveValue('')
    expect(searchbox()).toHaveFocus()
    expect(readSearchQuery()).toBe('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({ status: 'known' })
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
  })

  it('resets sheet filters from the sheet and leaves status, key, and the search alone', async () => {
    await setInstruments(db, 'user_1', ['banjo'])
    await setMeta(db, META_CATALOG_FILTERS, {
      status: 'known',
      key: 'D',
      banjo_tuning: 'gDGBD',
      archived: true,
    })
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'o')
    await userEvent.click(screen.getByRole('button', { name: 'Filters, 2 set' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(async () =>
      expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({
        status: 'known',
        key: 'D',
        banjo_tuning: 'all',
        archived: false,
      }),
    )
    expect(searchbox()).toHaveValue('o')
  })
})

describe('CatalogScreen search or create', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search songs' })

  it('offers to add the query under partial matches', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Soldier')
    expect(await screen.findByRole('link', { name: 'Add "Soldier"' })).toHaveAttribute(
      'href',
      '/songs/new?title=Soldier',
    )
    expect(screen.getByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
  })

  it('offers to add the query in the empty state when nothing matches', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Ashokan')
    expect(await screen.findByText('No song called "Ashokan"')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add "Ashokan"' })).toBeInTheDocument()
  })

  it('offers to add another song when a visible title matches exactly', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Cluck Old Hen')
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    expect(screen.getByRole('link', { name: 'Add another "Cluck Old Hen"' })).toHaveAttribute(
      'href',
      '/songs/new?title=Cluck+Old+Hen',
    )
    expect(screen.queryByRole('link', { name: /^Add "/ })).toBeNull()
  })

  it('points to an archived exact match beside the offer to add another', async () => {
    const { songId, userSongId } = await createSong(
      db,
      { title: 'Ashokan Farewell' },
      { status: 'known' },
    )
    await setArchived(db, userSongId, true)
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'ashokan farewell')
    expect(await screen.findByText('"Ashokan Farewell" is archived.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Ashokan Farewell' })).toHaveAttribute(
      'href',
      `/songs/${songId}`,
    )
    expect(screen.getByText('Nothing matches')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add another "ashokan farewell"' })).toBeInTheDocument()
  })

  it('keeps the query when clearing filters that hide an exact match', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: 'Learning' }))
    await userEvent.type(searchbox(), "soldier's joy")
    expect(
      await screen.findByText('"Soldier\'s Joy" is hidden by your filters.'),
    ).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'All' }),
    )
    // Anchored so the hidden-song note's "Open Soldier's Joy" link, gone once the filter clears, cannot match.
    expect(await screen.findByRole('link', { name: /^Soldier's Joy/ })).toBeInTheDocument()
    expect(searchbox()).toHaveValue("soldier's joy")
  })
})

describe('CatalogScreen search box Enter', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search songs' })

  it('opens the only matching song', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'cluck{Enter}')
    expect(await screen.findByRole('heading', { name: 'Cluck Old Hen' })).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/songs\//)
  })

  it('opens the new song form with the query as its title when nothing matches', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Ashokan Farewell{Enter}')
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Ashokan Farewell')
    expect(router.state.location.pathname).toBe('/songs/new')
  })

  it('opens the existing song rather than adding one with the same title', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Cluck Old Hen{Enter}')
    expect(await screen.findByRole('heading', { name: 'Cluck Old Hen' })).toBeInTheDocument()
    expect(router.state.location.pathname).not.toBe('/songs/new')
  })

  it('stays on the catalog and releases focus when several songs match', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'o{Enter}')
    expect(router.state.location.pathname).toBe('/')
    expect(searchbox()).not.toHaveFocus()
    expect(screen.getByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
  })
})

describe('CatalogScreen search across navigation', () => {
  const searchbox = () => screen.getByRole('searchbox', { name: 'Search songs' })

  it('keeps the search after opening a song and going back', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'cluck{Enter}')
    await screen.findByRole('heading', { name: 'Cluck Old Hen' })
    router.history.back()
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    expect(searchbox()).toHaveValue('cluck')
    expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull()
  })

  it('ends the search when the user cancels a song created from it', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Soldier')
    await userEvent.click(await screen.findByRole('link', { name: 'Add "Soldier"' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    expect(searchbox()).toHaveValue('')
  })

  it('saves a second song that shares a title with an existing one', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), "Soldier's Joy")
    await userEvent.click(await screen.findByRole('link', { name: 'Add another "Soldier\'s Joy"' }))
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue("Soldier's Joy")
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await screen.findByRole('heading', { name: "Soldier's Joy" })
    router.history.back()
    await screen.findByRole('link', { name: /Cluck Old Hen/ })
    expect(screen.getAllByRole('link', { name: /^Soldier's Joy/ })).toHaveLength(2)
  })

  it('ends the search when the user saves a song created from it and goes back', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'Ashokan Farewell{Enter}')
    await screen.findByRole('textbox', { name: 'Title' })
    await userEvent.click(screen.getByRole('button', { name: 'Add song' }))
    await screen.findByRole('heading', { name: 'Ashokan Farewell' })
    router.history.back()
    expect(await screen.findByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
    expect(searchbox()).toHaveValue('')
  })
})

describe('CatalogScreen swipe actions', () => {
  it('edits a song from its row and returns to the catalog on cancel', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: "Edit Soldier's Joy" }))
    expect(await screen.findByRole('heading', { name: 'Edit song' })).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ edit: true })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('archives a song from its row', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: "Archive Soldier's Joy" }))
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    expect((await db.user_songs.get(soldiersJoy))?.archived_at).not.toBeNull()
  })

  it('shows an archive failure above the list, where a long catalog keeps it in view', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    const reject = () => {
      throw new Error('Storage is full')
    }
    db.user_songs.hook('creating', reject)
    db.user_songs.hook('updating', reject)
    await userEvent.click(screen.getByRole('button', { name: "Archive Soldier's Joy" }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Storage is full')
    expect(
      alert.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('unarchives a song shown by Show archived', async () => {
    await setArchived(db, soldiersJoy, true)
    await setMeta(db, META_CATALOG_FILTERS, { archived: true })
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: "Unarchive Soldier's Joy" }))
    await waitFor(async () =>
      expect((await db.user_songs.get(soldiersJoy))?.archived_at).toBeNull(),
    )
  })
})
