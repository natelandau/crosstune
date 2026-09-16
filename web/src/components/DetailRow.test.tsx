import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DateRow, DetailRow, SwitchRow } from './DetailRow'

describe('DetailRow', () => {
  it('reads its label and value as one button and presses through', async () => {
    const onPress = vi.fn()
    render(<DetailRow label="Mode" value="Mixolydian" onPress={onPress} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mode Mixolydian' }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('shows a muted placeholder while empty', () => {
    render(<DetailRow label="Feel" value="" onPress={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Feel Not set' })).toBeInTheDocument()
    expect(screen.getByText('Not set')).toHaveClass('opacity-60')
  })
})

describe('SwitchRow', () => {
  it('toggles a switch named by its label', async () => {
    const onChange = vi.fn()
    render(
      <SwitchRow label="Crooked" checked={false} onChange={onChange} help="An odd count of bars" />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Crooked' })
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('An odd count of bars')).toBeInTheDocument()
    expect(checkbox).toHaveAccessibleDescription('An odd count of bars')
  })
})

describe('DateRow', () => {
  it('holds a native date input named by its label', async () => {
    const onChange = vi.fn()
    render(<DateRow label="Learned on" value="" onChange={onChange} />)
    const input = screen.getByLabelText('Learned on')
    expect(input).toHaveAttribute('type', 'date')
    await userEvent.type(input, '2026-03-03')
    expect(onChange).toHaveBeenLastCalledWith('2026-03-03')
  })
})
