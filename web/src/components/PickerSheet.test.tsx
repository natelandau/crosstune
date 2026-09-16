import { useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PickerSheet, TextSheet } from './PickerSheet'

function PickerHarness({ onClose, initial = '' }: { onClose: () => void; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <PickerSheet
        open
        title="Genre"
        value={value}
        options={['Irish']}
        other
        onChange={setValue}
        onClose={onClose}
      />
      <output>{value || '(none)'}</output>
    </>
  )
}

function ReopenHarness() {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('')
  return (
    <>
      <PickerSheet
        open={open}
        title="Genre"
        value={value}
        options={['Irish']}
        other
        onChange={setValue}
        onClose={() => setOpen(false)}
      />
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
    </>
  )
}

function TextHarness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <TextSheet
        open
        title="Learned from"
        value={value}
        onChange={setValue}
        onClose={onClose}
        help="A person or a recording"
      />
      <output>{value || '(none)'}</output>
    </>
  )
}

describe('PickerSheet', () => {
  it('sets the value and closes on one tap', async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <PickerSheet
        open
        title="Mode"
        value=""
        options={['major', 'minor']}
        onChange={onChange}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'minor' }))
    expect(onChange).toHaveBeenCalledWith('minor')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers Clear while a value is set', async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    render(
      <PickerSheet
        open
        title="Genre"
        value="Irish"
        options={['Irish']}
        onChange={onChange}
        onClose={onClose}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith('')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the sheet open while typing an Other value', async () => {
    const onClose = vi.fn()
    render(<PickerHarness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Other…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Other genre' }), 'Cajun')
    expect(screen.getByRole('status')).toHaveTextContent('Cajun')
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stays open when Other clears the option that was set', async () => {
    const onClose = vi.fn()
    render(<PickerHarness onClose={onClose} initial="Irish" />)
    await userEvent.click(screen.getByRole('button', { name: 'Other…' }))
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
    expect(screen.getByRole('dialog', { name: 'Genre' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Other genre' })).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when the Other text is erased back to empty', async () => {
    const onClose = vi.fn()
    render(<PickerHarness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Other…' }))
    const input = screen.getByRole('textbox', { name: 'Other genre' })
    await userEvent.type(input, 'Cajun')
    await userEvent.clear(input)
    expect(screen.getByRole('status')).toHaveTextContent('(none)')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open while typing past a value that matches an option', async () => {
    const onClose = vi.fn()
    render(<PickerHarness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Other…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Other genre' }), 'Irish trad')
    expect(screen.getByRole('status')).toHaveTextContent('Irish trad')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows chips again when it reopens after an Other input was left open', async () => {
    render(<ReopenHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Other…' }))
    expect(screen.getByRole('textbox', { name: 'Other genre' })).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'Genre' }) as HTMLDialogElement
    act(() => dialog.close())
    // A closed dialog keeps its content out of every role query, so the leftover input is
    // only visible to a plain DOM lookup.
    expect(document.querySelector('input[aria-label="Other genre"]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open picker' }))
    expect(screen.getByRole('button', { name: 'Irish' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Other genre' })).toBeNull()
  })
})

describe('TextSheet', () => {
  it('focuses its input, reports typing live, and closes on Done', async () => {
    const onClose = vi.fn()
    render(<TextHarness onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Learned from' })
    expect(input).toHaveFocus()
    await userEvent.type(input, 'Bruce')
    expect(screen.getByRole('status')).toHaveTextContent('Bruce')
    expect(screen.getByText('A person or a recording')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
