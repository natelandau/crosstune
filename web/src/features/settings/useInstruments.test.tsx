import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setInstruments } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { useInstruments } from './useInstruments'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function Probe() {
  const instruments = useInstruments()
  if (instruments === undefined) return <p>loading</p>
  return <p>{[...instruments].join(',') || 'none'}</p>
}

describe('useInstruments', () => {
  it('reports violin when the user has no settings row', async () => {
    renderWithProviders(<Probe />, { db })
    expect(await screen.findByText('violin')).toBeInTheDocument()
  })

  it("reflects the signed-in user's row and follows changes", async () => {
    await setInstruments(db, 'user_1', ['banjo', 'guitar'])
    await setInstruments(db, 'user_2', ['accordion'])
    renderWithProviders(<Probe />, { db })
    expect(await screen.findByText('banjo,guitar')).toBeInTheDocument()
    await setInstruments(db, 'user_1', [])
    expect(await screen.findByText('none')).toBeInTheDocument()
  })
})
