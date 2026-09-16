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
const group = (name: string) => screen.getByRole('group', { name })
const chip = (groupName: string, name: string) =>
  within(group(groupName)).getByRole('button', { name })
/** The field's label row, which carries its shared value or Mixed beside the name. */
const legend = (name: string) => screen.getByText(name).parentElement!
const pressed = (groupName: string) =>
  within(group(groupName))
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent)

describe('BatchEditSheet', () => {
  it('shows shared values and Mixed in the legends, with nothing pressed and Apply off', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Edit 2 songs' })).toBeInTheDocument()
    expect(legend('Key')).toHaveTextContent('A')
    expect(pressed('Key')).toEqual([])
    expect(legend('Violin tuning')).toHaveTextContent('Mixed')
    expect(legend('Status')).toHaveTextContent('Mixed')
    expect(screen.queryByRole('group', { name: 'Banjo tuning' })).toBeNull()
    expect(apply()).toBeDisabled()
  })

  it('marks a tapped chip as a change and applies only that field', async () => {
    const onApply = renderSheet()
    await userEvent.click(chip('Violin tuning', 'Cross A (AEAE)'))
    expect(pressed('Violin tuning')).toEqual(['Cross A (AEAE)'])
    expect(screen.getByText('will change')).toBeInTheDocument()
    expect(screen.getByText('1 change: violin tuning → Cross A (AEAE)')).toBeInTheDocument()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({
      song: { violin_tuning: 'Cross A (AEAE)' },
      userSong: {},
    })
  })

  it('clears a shared field from its No value chip', async () => {
    const onApply = renderSheet()
    await userEvent.click(chip('Genre', 'No value'))
    expect(screen.getByText('will clear')).toBeInTheDocument()
    expect(legend('Genre')).not.toHaveTextContent('Old-time')
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: { genre: null }, userSong: {} })
  })

  it('returns a field to untouched from its Undo', async () => {
    renderSheet()
    await userEvent.click(chip('Genre', 'No value'))
    await userEvent.click(screen.getByRole('button', { name: 'Undo Genre' }))
    expect(pressed('Genre')).toEqual([])
    expect(legend('Genre')).toHaveTextContent('Old-time')
    expect(screen.queryByText('will clear')).toBeNull()
    expect(apply()).toBeDisabled()
  })

  it('keeps a field untouched when a tap lands on its shared value', async () => {
    renderSheet()
    await userEvent.click(chip('Key', 'D'))
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.click(chip('Key', 'A'))
    expect(screen.queryByText('will change')).toBeNull()
    expect(pressed('Key')).toEqual([])
    expect(apply()).toBeDisabled()
  })

  it('keeps a field when its pressed chip is tapped again', async () => {
    renderSheet()
    await userEvent.click(chip('Key', 'D'))
    await userEvent.click(chip('Key', 'D'))
    expect(pressed('Key')).toEqual([])
    expect(screen.queryByText('will change')).toBeNull()
    expect(apply()).toBeDisabled()
  })

  it('sets status and a yes or no field, and offers no No value for status', async () => {
    const onApply = renderSheet()
    expect(within(group('Status')).queryByRole('button', { name: 'No value' })).toBeNull()
    await userEvent.click(chip('Status', 'Known'))
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

  it('leaves an empty field untouched when No value is tapped', async () => {
    const onApply = renderSheet()
    await userEvent.click(chip('Mode', 'minor'))
    await userEvent.click(chip('Mode', 'No value'))
    expect(screen.queryByText('will clear')).toBeNull()
    await userEvent.click(chip('Time signature', 'No value'))
    expect(apply()).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows the banjo tuning for a banjo player', () => {
    renderSheet(new Set(['violin', 'banjo']))
    expect(screen.getByRole('group', { name: 'Banjo tuning' })).toBeInTheDocument()
  })

  it('takes a value the chips lack through Other', async () => {
    const onApply = renderSheet()
    await userEvent.click(chip('Genre', 'Other…'))
    const input = screen.getByRole('textbox', { name: 'Other genre' })
    expect(input).toHaveValue('')
    expect(screen.queryByText('will clear')).toBeNull()
    await userEvent.type(input, 'Cajun Southern')
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.type(input, '{Enter}')
    expect(pressed('Genre')).toEqual(['Cajun Southern'])
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: { genre: 'Cajun Southern' }, userSong: {} })
  })

  it('goes back to keep when the Other text is emptied', async () => {
    renderSheet()
    await userEvent.click(chip('Genre', 'Other…'))
    const input = screen.getByRole('textbox', { name: 'Other genre' })
    await userEvent.type(input, 'Cajun')
    await userEvent.clear(input)
    expect(input).toHaveValue('')
    expect(screen.queryByText('will change')).toBeNull()
    expect(apply()).toBeDisabled()
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
    expect(legend('Mode')).toHaveTextContent('major')
    await userEvent.click(chip('Mode', 'No value'))
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
    expect(legend('Learned on')).toHaveTextContent('Mixed')
    expect(screen.getByLabelText('Learned on')).toHaveValue('')
  })

  it('applies an edited date to the user song', async () => {
    const onApply = renderSheet()
    fireEvent.change(screen.getByLabelText('Learned on'), { target: { value: '2021-05-02' } })
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith({ song: {}, userSong: { learned_on: '2021-05-02' } })
  })

  it('keeps a typed space while extending a shared text value', async () => {
    render(
      <BatchEditSheet
        open
        entries={[
          { song: songA, userSong: { ...userSongA, learned_from: 'Bruce' } },
          { song: songB, userSong: { ...userSongB, learned_from: 'Bruce' } },
        ]}
        instruments={new Set(['violin'])}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    )
    const from = screen.getByRole('textbox', { name: 'Learned from' })
    expect(from).toHaveValue('Bruce')
    await userEvent.type(from, ' Molsky')
    expect(from).toHaveValue('Bruce Molsky')
    expect(screen.getByText('will change')).toBeInTheDocument()
    await userEvent.clear(from)
    expect(screen.getByText('will clear')).toBeInTheDocument()
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
