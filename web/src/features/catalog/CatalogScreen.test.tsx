import { screen, waitFor } from '@testing-library/react'
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
      'bottom-[calc(5rem+env(safe-area-inset-bottom)+var(--player-dock-height,0px))]',
    )
  })

  it('leaves room below the last row for the add link', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    expect(screen.getByRole('list').parentElement).toHaveClass('pb-12')
  })

  it('offers only facets with values and only tunings for played instruments', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    expect(screen.getByRole('combobox', { name: 'Key' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Mode' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Violin tuning' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Banjo tuning' })).toBeNull()
    await setInstruments(db, 'user_1', ['banjo'])
    expect(await screen.findByRole('combobox', { name: 'Banjo tuning' })).toBeInTheDocument()
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

  it('keeps a just-typed query when a facet changes before the write settles', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search songs' }), 'sold')
    await userEvent.click(screen.getByRole('button', { name: 'Known' }))
    await waitFor(async () =>
      expect(await getMeta(db, META_CATALOG_FILTERS, null)).toMatchObject({
        query: 'sold',
        status: 'known',
      }),
    )
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

  it('offers no add row when a visible title matches exactly', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'cluck old hen')
    await waitFor(() => expect(screen.queryByRole('link', { name: /Soldier's Joy/ })).toBeNull())
    expect(screen.queryByRole('link', { name: /^Add "/ })).toBeNull()
  })

  it('points to an archived exact match instead of offering a duplicate', async () => {
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
    expect(screen.queryByRole('link', { name: /^Add "/ })).toBeNull()
  })

  it('keeps the query when clearing filters that hide an exact match', async () => {
    renderWithProviders(<CatalogScreen />, { db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.click(screen.getByRole('button', { name: 'Learning' }))
    await userEvent.type(searchbox(), "soldier's joy")
    expect(
      await screen.findByText('"Soldier\'s Joy" is hidden by your filters.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
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

  it('stays on the catalog and releases focus when several songs match', async () => {
    const { router } = renderApp({ db })
    await screen.findByRole('link', { name: /Soldier's Joy/ })
    await userEvent.type(searchbox(), 'o{Enter}')
    expect(router.state.location.pathname).toBe('/')
    expect(searchbox()).not.toHaveFocus()
    expect(screen.getByRole('link', { name: /Cluck Old Hen/ })).toBeInTheDocument()
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
