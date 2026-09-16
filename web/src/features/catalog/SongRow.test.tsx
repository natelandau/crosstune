import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Archive, SquarePen } from 'lucide-react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLICK_GUARD_MS } from '../../components/swipe'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { songRow, userSongRow } from '../../test/rows'
import { SongRow, type RowSelection } from './SongRow'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, CLICK_GUARD_MS + 10))
  await db.delete()
})

const entry = {
  song: songRow('s1', "Soldier's Joy", { key: 'D' }),
  userSong: userSongRow('u1', 's1'),
}

function renderSongRow(selection?: Partial<RowSelection>) {
  const handlers = { onToggle: vi.fn(), onLongPress: vi.fn() }
  renderWithProviders(
    <SongRow
      entry={entry}
      instruments={new Set()}
      actions={[
        {
          label: 'Edit',
          tone: 'neutral',
          onPress: vi.fn(),
          icon: <SquarePen aria-hidden="true" />,
        },
        {
          label: 'Archive',
          tone: 'warning',
          onPress: vi.fn(),
          icon: <Archive aria-hidden="true" />,
        },
      ]}
      open={false}
      otherOpen={false}
      onOpenChange={vi.fn()}
      onSwipeStart={vi.fn()}
      closeOpenRow={vi.fn()}
      selection={
        selection
          ? { active: false, selected: false, index: 0, ...handlers, ...selection }
          : undefined
      }
    />,
    { db },
  )
  return handlers
}

describe('SongRow', () => {
  it('links to the song and hides the checkbox outside selection mode', async () => {
    renderSongRow({ active: false })
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('becomes a labeled checkbox with no link in selection mode', async () => {
    renderSongRow({ active: true, selected: true })
    expect(await screen.findByRole('checkbox', { name: "Soldier's Joy" })).toBeChecked()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('toggles from a tap anywhere on the row', async () => {
    const { onToggle } = renderSongRow({ active: true })
    await userEvent.click(await screen.findByText("Soldier's Joy"))
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('toggles once from the checkbox itself and passes Shift', async () => {
    const { onToggle } = renderSongRow({ active: true })
    const user = userEvent.setup()
    await user.keyboard('{Shift>}')
    await user.click(await screen.findByRole('checkbox', { name: "Soldier's Joy" }))
    await user.keyboard('{/Shift}')
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('offers a long-press only outside selection mode', async () => {
    const { onLongPress } = renderSongRow({ active: false })
    const text = await screen.findByText("Soldier's Joy")
    fireEvent.pointerDown(text, {
      clientX: 10,
      clientY: 10,
      isPrimary: true,
      button: 0,
      pointerId: 1,
    })
    await waitFor(() => expect(onLongPress).toHaveBeenCalledTimes(1), { timeout: 3000 })
    fireEvent.pointerUp(text, { isPrimary: true, pointerId: 1 })
  })

  it('renders plainly without a selection prop', async () => {
    renderSongRow()
    expect(await screen.findByRole('link', { name: /Soldier's Joy/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { hidden: true })).toBeNull()
  })
})
