import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Instrument } from '../../db/types'
import { emptyValues, inputsFromValues, SongForm, valuesFromRows } from './SongForm'

const violin = new Set<Instrument>(['violin'])

function renderForm(props: Partial<Parameters<typeof SongForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => {})
  render(<SongForm submitLabel="Save" onSubmit={onSubmit} instruments={violin} {...props} />)
  return onSubmit
}

describe('SongForm', () => {
  it('puts title, status, key, tuning, and notes first and the rest in a details list', () => {
    renderForm()
    const title = screen.getByRole('textbox', { name: 'Title' })
    const status = screen.getByRole('radio', { name: 'Known' })
    const key = screen.getByRole('group', { name: 'Key' })
    const tuning = screen.getByRole('group', { name: 'Violin tuning' })
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    const details = screen.getByRole('heading', { name: 'Details' })
    const pairs: [HTMLElement, HTMLElement][] = [
      [title, status],
      [status, key],
      [key, tuning],
      [tuning, notes],
      [notes, details],
    ]
    for (const [before, after] of pairs) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Time signature 4/4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mode Not set' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Crooked' })).not.toBeChecked()
  })

  it('requires a title and reports it under the field', async () => {
    const onSubmit = renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('A title is required')
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(title).toHaveFocus()
    expect(title.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('submits normalized inputs from chips, sheets, and switches', async () => {
    const onSubmit = renderForm()
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '  Cluck Old Hen ')
    await userEvent.click(screen.getByRole('radio', { name: 'Learning' }))
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Key' })).getByRole('button', { name: 'A' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Also known as Not set' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Also known as' }), 'Cluck, Old Hen ,')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mode Not set' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Mode' })).getByRole('button', {
        name: 'mixolydian',
      }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Mode mixolydian' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Crooked' }))
    await userEvent.click(screen.getByRole('button', { name: 'Learned from Not set' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Learned from' }), 'Bruce')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cluck Old Hen',
        alternate_titles: ['Cluck', 'Old Hen'],
        key: 'A',
        mode: 'mixolydian',
        is_crooked: true,
        violin_tuning: null,
        banjo_tuning: null,
        time_signature: '4/4',
      }),
      expect.objectContaining({ status: 'learning', learned_from: 'Bruce', notes: null }),
    )
  })

  it('reports a rejected save inside the save bar', async () => {
    render(
      <SongForm
        submitLabel="Save"
        instruments={violin}
        onSubmit={() => Promise.reject(new Error('The write was refused'))}
      />,
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'Cluck Old Hen')
    const save = screen.getByRole('button', { name: 'Save' })
    await userEvent.click(save)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The write was refused')
    expect(save.closest('.fixed')).toContainElement(alert)
  })

  it('drops a stale rejection when the next submit fails validation', async () => {
    render(
      <SongForm
        submitLabel="Save"
        instruments={violin}
        onSubmit={() => Promise.reject(new Error('The write was refused'))}
      />,
    )
    const title = screen.getByRole('textbox', { name: 'Title' })
    await userEvent.type(title, 'Cluck Old Hen')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('The write was refused')
    await userEvent.clear(title)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('A title is required')
  })

  it('accepts a key and a tuning that are not in the suggestions', async () => {
    const onSubmit = renderForm()
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'X')
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Key' })).getByRole('button', { name: 'Other…' }),
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Other key' }), 'Bb')
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Violin tuning' })).getByRole('button', {
        name: 'Other…',
      }),
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Other violin tuning' }), 'ADAE')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'Bb', violin_tuning: 'ADAE' }),
      expect.anything(),
    )
  })

  it('shows one tuning group per played instrument', () => {
    renderForm({ instruments: new Set<Instrument>(['violin', 'banjo']) })
    expect(screen.getByRole('group', { name: 'Violin tuning' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Banjo tuning' })).toBeInTheDocument()
  })

  it('hides a tuning for an unplayed instrument unless the song has a value', () => {
    const { unmount } = render(
      <SongForm
        submitLabel="Save"
        onSubmit={vi.fn(async () => {})}
        instruments={new Set<Instrument>(['guitar'])}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Violin tuning' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Banjo tuning' })).toBeNull()
    unmount()
    render(
      <SongForm
        submitLabel="Save"
        onSubmit={vi.fn(async () => {})}
        instruments={new Set<Instrument>(['guitar'])}
        initial={{ ...emptyValues(), banjo_tuning: 'gDGBD' }}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Violin tuning' })).toBeNull()
    expect(
      within(screen.getByRole('group', { name: 'Banjo tuning' })).getByRole('button', {
        name: 'gDGBD',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('round-trips rows through values', () => {
    const values = valuesFromRows(
      {
        id: 's',
        created_at: 't',
        updated_at: 't',
        deleted_at: null,
        server_seq: 0,
        title: 'X',
        alternate_titles: ['Y', 'Z'],
        genre: 'Old-time',
        feel: null,
        has_lyrics: true,
        key: 'D',
        mode: 'major',
        violin_tuning: 'ADAE',
        banjo_tuning: null,
        part_structure: 'AABB',
        time_signature: '3/4',
        is_crooked: false,
      },
      {
        id: 'u',
        created_at: 't',
        updated_at: 't',
        deleted_at: null,
        server_seq: 0,
        song_id: 's',
        status: 'known',
        learned_from: null,
        learned_on: '2024-05-01',
        notes: 'n',
        archived_at: null,
      },
    )
    expect(values.alternate_titles).toBe('Y, Z')
    expect(values.time_signature).toBe('3/4')
    expect(values.violin_tuning).toBe('ADAE')
    expect(values.banjo_tuning).toBe('')
    const { song, userSong } = inputsFromValues(values)
    expect(song).toMatchObject({
      alternate_titles: ['Y', 'Z'],
      has_lyrics: true,
      time_signature: '3/4',
    })
    expect(userSong).toMatchObject({ status: 'known', learned_on: '2024-05-01', notes: 'n' })
    expect(emptyValues().status).toBe('want_to_learn')
  })

  it('falls back for facets a server row carries that this client does not know', () => {
    const values = valuesFromRows(
      {
        id: 's',
        created_at: 't',
        updated_at: 't',
        deleted_at: null,
        server_seq: 0,
        title: 'X',
        alternate_titles: [],
        genre: null,
        feel: null,
        has_lyrics: null,
        key: null,
        mode: 'lydian',
        violin_tuning: null,
        banjo_tuning: null,
        part_structure: null,
        time_signature: '7/8',
        is_crooked: false,
      },
      {
        id: 'u',
        created_at: 't',
        updated_at: 't',
        deleted_at: null,
        server_seq: 0,
        song_id: 's',
        status: 'bogus',
        learned_from: null,
        learned_on: null,
        notes: null,
        archived_at: null,
      },
    )
    expect(values.mode).toBe('')
    expect(values.time_signature).toBe('')
    expect(values.status).toBe('want_to_learn')
  })
})
