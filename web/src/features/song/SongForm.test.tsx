import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { emptyValues, inputsFromValues, SongForm, valuesFromRows } from './SongForm'

describe('SongForm', () => {
  it('defaults the time signature to 4/4 and requires a title', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SongForm submitLabel="Save" onSubmit={onSubmit} />)
    expect(screen.getByRole('combobox', { name: 'Time signature' })).toHaveValue('4/4')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits normalized inputs', async () => {
    const onSubmit = vi.fn(async () => {})
    render(<SongForm submitLabel="Save" onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '  Cluck Old Hen ')
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Alternate titles' }),
      'Cluck, Old Hen ,',
    )
    await userEvent.type(screen.getByRole('combobox', { name: 'Key' }), 'A')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'mixolydian')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Crooked' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Learning' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Learned from' }), 'Bruce')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Cluck Old Hen',
        alternate_titles: ['Cluck', 'Old Hen'],
        key: 'A',
        mode: 'mixolydian',
        is_crooked: true,
        tuning: null,
        time_signature: '4/4',
      }),
      expect.objectContaining({ status: 'learning', learned_from: 'Bruce', notes: null }),
    )
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
        tuning: 'ADAE',
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
        tuning: null,
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
