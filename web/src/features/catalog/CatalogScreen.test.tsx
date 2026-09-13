import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSong } from '../../commands/songs'
import { setInstruments } from '../../commands/settings'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { CatalogScreen } from './CatalogScreen'
import { META_CATALOG_FILTERS } from './filters'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createSong(
    db,
    { title: "Soldier's Joy", key: 'D', banjo_tuning: 'gDGBD' },
    { status: 'known' },
  )
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
