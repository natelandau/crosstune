import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../../db/types'
import { songRow, userSongRow } from '../../test/rows'
import { BatchEditSheet } from './BatchEditSheet'

const songA = songRow('s1', 'Say Old Man', {
  key: 'A',
  violin_tuning: 'Standard (GDAE)',
  genre: 'Old-time',
})
const songB = songRow('s2', 'Lost Indian', {
  key: 'A',
  violin_tuning: 'Cross A (AEAE)',
  genre: 'Old-time',
})
const userSongA = userSongRow('u1', 's1', { status: 'known' })
const userSongB = userSongRow('u2', 's2', { status: 'learning' })

const entries = [
  { song: songA, userSong: userSongA },
  { song: songB, userSong: userSongB },
]

function renderSheet(instruments: ReadonlySet<Instrument> = new Set(['violin'])) {
  const onApply = vi.fn()
  render(
    <BatchEditSheet
      open
      entries={entries}
      instruments={instruments}
      onClose={vi.fn()}
      onApply={onApply}
    />,
  )
  return onApply
}

const apply = () => screen.getByRole('button', { name: 'Apply to 2' })

describe('BatchEditSheet', () => {
  it('shows shared values and Mixed, with Apply off until something changes', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Edit 2 songs' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Key' })).toHaveValue('A')
    expect(screen.getByRole('combobox', { name: 'Violin tuning' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Violin tuning' })).toHaveAttribute(
      'placeholder',
      'Mixed',
    )
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveDisplayValue('Mixed')
    expect(screen.queryByRole('combobox', { name: 'Banjo tuning' })).toBeNull()
    expect(apply()).toBeDisabled()
  })

  it('marks an edited field and applies only that field', async () => {
    const onApply = renderSheet()
    await userEvent.type(screen.getByRole('combobox', { name: 'Violin tuning' }), 'Cross A (AEAE)')
    expect(screen.getByText('will change')).toBeInTheDocument()
    expect(screen.getByText('1 change: violin tuning → Cross A (AEAE)')).toBeInTheDocument()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({
      song: { violin_tuning: 'Cross A (AEAE)' },
      userSong: {},
    })
  })

  it('marks an emptied shared field as a clear', async () => {
    const onApply = renderSheet()
    await userEvent.clear(screen.getByRole('combobox', { name: 'Genre' }))
    expect(screen.getByText('will clear')).toBeInTheDocument()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: { genre: null }, userSong: {} })
  })

  it('returns a field to untouched from its Undo', async () => {
    renderSheet()
    await userEvent.clear(screen.getByRole('combobox', { name: 'Genre' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo Genre' }))
    expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('Old-time')
    expect(screen.queryByText('will clear')).toBeNull()
    expect(apply()).toBeDisabled()
  })

  it('leaves a field untouched when set back to its shared value', async () => {
    renderSheet()
    const key = screen.getByRole('combobox', { name: 'Key' })
    await userEvent.type(key, 'b')
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.type(key, '{Backspace}')
    expect(screen.queryByText('will change')).toBeNull()
  })

  it('sets status and a yes or no field', async () => {
    const onApply = renderSheet()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Known')
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Crooked' })).getByRole('radio', {
        name: 'Yes',
      }),
    )
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({
      song: { is_crooked: true },
      userSong: { status: 'known' },
    })
  })

  it('clears a select field with No value', async () => {
    const onApply = renderSheet()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'minor')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'No value')
    expect(screen.queryByText('will clear')).toBeNull()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Time signature' }),
      'No value',
    )
    expect(apply()).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows the banjo tuning for a banjo player', () => {
    renderSheet(new Set(['violin', 'banjo']))
    expect(screen.getByRole('combobox', { name: 'Banjo tuning' })).toBeInTheDocument()
  })

  it('keeps a typed space while extending a shared value', async () => {
    renderSheet()
    const genre = screen.getByRole('combobox', { name: 'Genre' })
    await userEvent.type(genre, ' Southern')
    expect(genre).toHaveValue('Old-time Southern')
    expect(screen.getByText('will change')).toBeInTheDocument()
  })

  it('clears a select field that already shares a value', async () => {
    const onApply = vi.fn()
    render(
      <BatchEditSheet
        open
        entries={[
          { song: { ...songA, mode: 'major' }, userSong: userSongA },
          { song: { ...songB, mode: 'major' }, userSong: userSongB },
        ]}
        instruments={new Set(['violin'])}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    )
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'No value')
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: { mode: null }, userSong: {} })
  })

  it('shows a mixed hint on the date field when learned dates differ', () => {
    render(
      <BatchEditSheet
        open
        entries={[
          { song: songA, userSong: { ...userSongA, learned_on: '2020-01-01' } },
          { song: songB, userSong: { ...userSongB, learned_on: '2021-06-15' } },
        ]}
        instruments={new Set(['violin'])}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )
    const fieldset = screen.getByText('Learned on').closest('fieldset')!
    expect(within(fieldset).getByText('Mixed')).toBeInTheDocument()
  })

  it('applies an edited date to the user song', async () => {
    const onApply = renderSheet()
    fireEvent.change(screen.getByLabelText('Learned on'), { target: { value: '2021-05-02' } })
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: {}, userSong: { learned_on: '2021-05-02' } })
  })

  it('applies Has lyrics as a song field', async () => {
    const onApply = renderSheet()
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Has lyrics' })).getByRole('radio', {
        name: 'Yes',
      }),
    )
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: { has_lyrics: true }, userSong: {} })
  })
})
