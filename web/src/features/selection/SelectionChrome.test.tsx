import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppBar } from '../../components/AppBar'
import { Dock } from '../../components/Dock'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { useSelectionChrome, type SelectionChrome } from './selectionChrome'
import { SelectionChromeProvider } from './SelectionChromeProvider'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function Publisher({ chrome }: { chrome: SelectionChrome | null }) {
  useSelectionChrome(chrome)
  return null
}

const CHROME: SelectionChrome = {
  bar: <p>3 selected</p>,
  actions: <button type="button">Status</button>,
}

function renderChrome(chrome: SelectionChrome | null) {
  return renderWithProviders(
    <SelectionChromeProvider>
      <Publisher chrome={chrome} />
      <AppBar />
      <Dock />
    </SelectionChromeProvider>,
    { db },
  )
}

describe('selection chrome', () => {
  it('shows the normal bars when nothing is published', async () => {
    renderChrome(null)
    expect(await screen.findByRole('link', { name: 'Crosstune' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).not.toHaveAttribute('inert')
    expect(screen.queryByRole('toolbar', { name: 'Selected songs' })).toBeNull()
  })

  it('swaps both bars for the published content', async () => {
    renderChrome(CHROME)
    expect(await screen.findByText('3 selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Selected songs' })).not.toHaveAttribute('inert')
    expect(screen.queryByRole('link', { name: 'Crosstune' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })

  it('keeps the last content in place while the selection bars leave', async () => {
    renderWithProviders(
      <SelectionChromeProvider>
        <TogglingPublisher />
        <AppBar />
        <Dock />
      </SelectionChromeProvider>,
      { db },
    )
    await screen.findByText('3 selected')
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(await screen.findByRole('link', { name: 'Crosstune' })).toBeInTheDocument()
    const hiddenBar = screen.getByText('3 selected', { selector: 'p' })
    expect(hiddenBar.closest('[inert]')).not.toBeNull()
  })
})

function TogglingPublisher() {
  const [on, setOn] = useState(true)
  useSelectionChrome(on ? CHROME : null)
  return (
    <button type="button" onClick={() => setOn(false)}>
      Leave
    </button>
  )
}
