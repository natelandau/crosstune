import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RESET } from './panel'
import { FASTER, SLOWER, SPEED, SpeedPanel } from './SpeedPanel'

function Harness({ initial, onChange }: { initial: number; onChange: (v: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <SpeedPanel
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('SpeedPanel', () => {
  it('steps by 5% and stops at 50% and 150%', async () => {
    const onChange = vi.fn()
    render(<Harness initial={140} onChange={onChange} />)
    const faster = screen.getByRole('button', { name: FASTER })
    await userEvent.click(faster)
    await userEvent.click(faster)
    await userEvent.click(faster)
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([145, 150])
    expect(faster).toBeDisabled()
    expect(screen.getByRole('slider', { name: SPEED })).toHaveValue('150')
  })

  it('steps down to 50% and no further', async () => {
    const onChange = vi.fn()
    render(<Harness initial={55} onChange={onChange} />)
    const slower = screen.getByRole('button', { name: SLOWER })
    await userEvent.click(slower)
    await userEvent.click(slower)
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([50])
    expect(slower).toBeDisabled()
  })

  it('jumps to a preset chip and marks it chosen', async () => {
    const onChange = vi.fn()
    render(<Harness initial={100} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '75%' }))
    expect(onChange).toHaveBeenLastCalledWith(75)
    expect(screen.getByRole('button', { name: '75%' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('clamps a slider value into range and resets to 100%', async () => {
    const onChange = vi.fn()
    render(<Harness initial={100} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: SPEED }), { target: { value: '120' } })
    expect(onChange).toHaveBeenLastCalledWith(120)
    await userEvent.click(screen.getByRole('button', { name: RESET }))
    expect(onChange).toHaveBeenLastCalledWith(100)
    expect(screen.getByRole('button', { name: RESET })).toBeDisabled()
  })
})
