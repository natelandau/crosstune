import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PITCH_UNAVAILABLE } from '../player/Dock'
import {
  CENTS,
  PITCH_DOWN,
  PITCH_PAUSES_ON_LOCK,
  PITCH_UP,
  PitchPanel,
  SEMITONES,
} from './PitchPanel'
import { RESET } from './panel'

function Harness({ initial, onChange }: { initial: number; onChange: (v: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <PitchPanel
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

afterEach(() => {
  document.documentElement.classList.remove('ios')
})

describe('PitchPanel', () => {
  it('combines semitones and cents into one pitch in cents', async () => {
    const onChange = vi.fn()
    render(<Harness initial={0} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: PITCH_UP }))
    await userEvent.click(screen.getByRole('button', { name: PITCH_UP }))
    fireEvent.change(screen.getByRole('slider', { name: CENTS }), { target: { value: '30' } })
    expect(onChange).toHaveBeenLastCalledWith(230)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent('+2')
  })

  it.each([
    [250, '+2', '50'],
    [-250, '-2', '-50'],
  ])('splits a pitch of %i cents from elsewhere toward zero', (value, semitones, cents) => {
    render(<PitchPanel value={value} onChange={() => {}} />)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent(semitones)
    expect(screen.getByRole('slider', { name: CENTS })).toHaveValue(cents)
  })

  it('reaches +50 cents without moving the semitones', async () => {
    const onChange = vi.fn()
    render(<Harness initial={200} onChange={onChange} />)
    const cents = screen.getByRole('slider', { name: CENTS })
    fireEvent.change(cents, { target: { value: '50' } })
    expect(onChange).toHaveBeenLastCalledWith(250)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent('+2')
    expect(cents).toHaveValue('50')
    fireEvent.change(cents, { target: { value: '40' } })
    fireEvent.change(cents, { target: { value: '50' } })
    expect(onChange).toHaveBeenLastCalledWith(250)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent('+2')
    expect(cents).toHaveValue('50')
    await userEvent.click(screen.getByRole('button', { name: PITCH_UP }))
    expect(onChange).toHaveBeenLastCalledWith(350)
  })

  it('follows a pitch changed from elsewhere', () => {
    const { rerender } = render(<PitchPanel value={250} onChange={vi.fn()} />)
    rerender(<PitchPanel value={-170} onChange={vi.fn()} />)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent('-2')
    expect(screen.getByRole('slider', { name: CENTS })).toHaveValue('30')
  })

  it('splits a stored pitch into semitones and cents', () => {
    render(<PitchPanel value={-170} onChange={vi.fn()} />)
    expect(screen.getByRole('status', { name: SEMITONES })).toHaveTextContent('-2')
    expect(screen.getByRole('slider', { name: CENTS })).toHaveValue('30')
  })

  it('stops the semitones at 12 either way', async () => {
    const onChange = vi.fn()
    render(<Harness initial={-1150} onChange={onChange} />)
    // -1150 reads as -11 semitones and -50 cents.
    await userEvent.click(screen.getByRole('button', { name: PITCH_DOWN }))
    expect(onChange).toHaveBeenLastCalledWith(-1200)
    expect(screen.getByRole('button', { name: PITCH_DOWN })).toBeDisabled()
  })

  it('never goes past a full octave with cents added', () => {
    const onChange = vi.fn()
    render(<PitchPanel value={1200} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: CENTS }), { target: { value: '40' } })
    expect(onChange).toHaveBeenLastCalledWith(1200)
  })

  it('resets to no shift', async () => {
    const onChange = vi.fn()
    render(<Harness initial={230} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: RESET }))
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('says when pitch shift is unavailable', () => {
    render(<PitchPanel value={200} onChange={vi.fn()} unavailable />)
    expect(screen.getByText(PITCH_UNAVAILABLE)).toBeInTheDocument()
  })

  it('warns on iOS that pitch-shifted playback pauses on lock, and only there', () => {
    const { unmount } = render(<PitchPanel value={0} onChange={vi.fn()} />)
    expect(screen.queryByText(PITCH_PAUSES_ON_LOCK)).not.toBeInTheDocument()
    unmount()
    document.documentElement.classList.add('ios')
    render(<PitchPanel value={0} onChange={vi.fn()} />)
    expect(screen.getByText(PITCH_PAUSES_ON_LOCK)).toBeInTheDocument()
  })
})
