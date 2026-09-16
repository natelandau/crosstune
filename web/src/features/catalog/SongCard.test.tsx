import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import type { Instrument, LocalSong, LocalUserSong } from '../../db/types'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { songRow, userSongRow } from '../../test/rows'
import { SongCard } from './SongCard'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function renderCard(
  song: Partial<LocalSong>,
  userSong: Partial<LocalUserSong> = {},
  instruments: Instrument[] = ['violin'],
) {
  const entry = {
    song: songRow('s1', "Soldier's Joy", song),
    userSong: userSongRow('u1', 's1', userSong),
  }
  renderWithProviders(<SongCard entry={entry} instruments={new Set(instruments)} />, { db })
  return screen.findByRole('link', { name: /Soldier's Joy/ })
}

describe('SongCard', () => {
  it('puts the title alone on the first row, large and truncated', async () => {
    await renderCard({ key: 'D' })
    expect(screen.getByText("Soldier's Joy")).toHaveClass('truncate', 'text-title')
  })

  it('shows the key and status on the second row', async () => {
    const link = await renderCard({ key: 'D' })
    expect(link.textContent).toBe("Soldier's JoyKey DKnown")
    const label = screen.getByText('Key')
    expect(label).toHaveClass('sr-only')
    expect(label.parentElement).toHaveClass('font-semibold', 'tabular-nums')
    expect(label.parentElement).toHaveTextContent('Key D')
  })

  it('leaves out a missing key', async () => {
    const link = await renderCard({ key: null })
    expect(link.textContent).toBe("Soldier's JoyKnown")
  })

  it.each([
    ['known', 'Known'],
    ['learning', 'Learning'],
    ['want_to_learn', 'Want to learn'],
  ] as const)('labels the %s status', async (status, label) => {
    await renderCard({}, { status })
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows a tuning only for a played instrument with a value', async () => {
    const link = await renderCard({ violin_tuning: 'AEAE', banjo_tuning: 'gDGBD' })
    expect(link).toHaveTextContent('AEAE')
    expect(link).not.toHaveTextContent('gDGBD')
  })

  it('joins tunings for every played instrument', async () => {
    await renderCard({ violin_tuning: 'AEAE', banjo_tuning: 'gDGBD' }, {}, ['violin', 'banjo'])
    expect(screen.getByText('AEAE · gDGBD')).toBeInTheDocument()
  })

  it('marks an archived song and dims its row', async () => {
    const link = await renderCard({}, { archived_at: '2026-09-01T00:00:00.000Z' })
    expect(screen.getByText('Archived')).toBeInTheDocument()
    expect(link).toHaveClass('opacity-60')
  })

  it('leaves an active song at full tone', async () => {
    const link = await renderCard({})
    expect(link).not.toHaveClass('opacity-60')
  })

  it('renders without a link when not linked', () => {
    render(
      <SongCard
        entry={{
          song: songRow('s1', "Soldier's Joy", { key: 'D' }),
          userSong: userSongRow('u1', 's1'),
        }}
        instruments={new Set()}
        linked={false}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText("Soldier's Joy")).toBeInTheDocument()
  })
})
