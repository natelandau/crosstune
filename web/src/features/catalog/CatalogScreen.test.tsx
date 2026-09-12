import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSong } from '../../commands/songs'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { CatalogScreen } from './CatalogScreen'
import { META_CATALOG_FILTERS } from './filters'

let db: CrosstuneDb

beforeEach(async () => {
  db = openTestDb()
  await createSong(db, { title: "Soldier's Joy", key: 'D' }, { status: 'known' })
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
})
