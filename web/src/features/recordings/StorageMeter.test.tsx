import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { StorageMeter } from './StorageMeter'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('StorageMeter', () => {
  it('renders the used and quota figures once storage is known', async () => {
    await setStorage(db, { used_bytes: 200_000_000, quota_bytes: 1_000_000_000, max_file_bytes: 1 })
    renderWithProviders(<StorageMeter />, { db })
    expect(await screen.findByText('200 MB of 1 GB used')).toBeInTheDocument()
  })

  it('renders nothing when the reported quota is zero', async () => {
    await setStorage(db, { used_bytes: 0, quota_bytes: 0, max_file_bytes: 0 })
    renderWithProviders(<StorageMeter />, { db })
    // Give the live query a tick to resolve before asserting the meter stayed empty.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByLabelText('Storage used')).not.toBeInTheDocument()
  })
})
