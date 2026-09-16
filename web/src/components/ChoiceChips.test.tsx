import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ChoiceChips } from './ChoiceChips'

const KEYS = ['A', 'D', 'G']

function Harness({ other = false, emptyOption }: { other?: boolean; emptyOption?: string }) {
  const [value, setValue] = useState('')
  return (
    <>
      <ChoiceChips
        label="Key"
        value={value}
        options={KEYS}
        onChange={setValue}
        other={other}
        emptyOption={emptyOption}
      />
      <output>{value || '(none)'}</output>
    </>
  )
}

describe('ChoiceChips', () => {
  it('sets a value with one tap and clears it by tapping the pressed chip', async () => {
    render(<Harness />)
    const group = screen.getByRole('group', { name: 'Key' })
    await userEvent.click(within(group).getByRole('button', { name: 'D' }))
    expect(within(group).getByRole('button', { name: 'D' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('D')
    await userEvent.click(within(group).getByRole('button', { name: 'D' }))
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
  })

  it('offers an empty option that is pressed while nothing is chosen', async () => {
    render(<Harness emptyOption="All" />)
    const group = screen.getByRole('group', { name: 'Key' })
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(group).getByRole('button', { name: 'A' }))
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await userEvent.click(within(group).getByRole('button', { name: 'All' }))
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
  })

  it('reveals an input behind Other and shows the typed value as a pressed chip', async () => {
    render(<Harness other />)
    const group = screen.getByRole('group', { name: 'Key' })
    expect(screen.queryByRole('textbox', { name: 'Other key' })).toBeNull()
    await userEvent.click(within(group).getByRole('button', { name: 'Other…' }))
    const input = screen.getByRole('textbox', { name: 'Other key' })
    expect(input).toHaveFocus()
    await userEvent.type(input, 'Bb')
    expect(screen.getByRole('status')).toHaveTextContent('Bb')
    await userEvent.tab()
    expect(screen.queryByRole('textbox', { name: 'Other key' })).toBeNull()
    expect(within(group).getByRole('button', { name: 'Bb' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(group).getByRole('button', { name: 'Bb' }))
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
    expect(within(group).queryByRole('button', { name: 'Bb' })).toBeNull()
  })

  it('hides custom chip and Other button while input is open', async () => {
    render(<Harness other />)
    const group = screen.getByRole('group', { name: 'Key' })
    await userEvent.click(within(group).getByRole('button', { name: 'Other…' }))
    const input = screen.getByRole('textbox', { name: 'Other key' })
    await userEvent.type(input, 'Bb')
    expect(within(group).queryByRole('button', { name: 'Bb' })).toBeNull()
    expect(within(group).queryByRole('button', { name: 'Other…' })).toBeNull()
    await userEvent.tab()
    expect(within(group).getByRole('button', { name: 'Bb' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(group).getByRole('button', { name: 'Other…' })).toBeInTheDocument()
  })

  it('types a value that briefly matches an option without losing keystrokes', async () => {
    render(<Harness other />)
    const group = screen.getByRole('group', { name: 'Key' })
    await userEvent.click(within(group).getByRole('button', { name: 'Other…' }))
    const input = screen.getByRole('textbox', { name: 'Other key' })
    // "B" alone is not one of this harness's KEYS, but "A" is, so typing through a
    // one-letter prefix that happens to be a real option must not clear the field.
    await userEvent.type(input, 'Ab')
    expect(screen.getByRole('status')).toHaveTextContent('Ab')
    await userEvent.tab()
    expect(within(group).getByRole('button', { name: 'Ab' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('clears a chosen option when Other is opened, so typing starts blank', async () => {
    render(<Harness other />)
    const group = screen.getByRole('group', { name: 'Key' })
    await userEvent.click(within(group).getByRole('button', { name: 'A' }))
    expect(within(group).getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: 'Other…' }))
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
    const input = screen.getByRole('textbox', { name: 'Other key' })
    expect(input).toHaveFocus()
    expect(input).toHaveValue('')
  })

  it('shows a preset custom value as a chip without opening the input', () => {
    const onChange = vi.fn()
    render(<ChoiceChips label="Key" value="Bb" options={KEYS} onChange={onChange} other />)
    const group = screen.getByRole('group', { name: 'Key' })
    expect(within(group).getByRole('button', { name: 'Bb' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
