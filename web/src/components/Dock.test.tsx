import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openTestDb } from '../test/db'
import { renderApp } from '../test/render'

beforeEach(() => {
  // jsdom has no Web Audio API; the record button unlocks a context inside its click handler.
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      resume = vi.fn(async () => {})
      suspend = vi.fn(async () => {})
    },
  )
})

describe('Dock', () => {
  it('has four tabs around a centered record button', async () => {
    const db = openTestDb()
    try {
      renderApp({ db })
      const nav = await screen.findByRole('navigation', { name: 'Primary' })
      const names = Array.from(nav.children).map(
        (c) => c.textContent || c.getAttribute('aria-label'),
      )
      expect(names).toEqual(['Catalog', 'Lists', 'Start a new recording', 'Recordings', 'Settings'])
      // Each tab is a glyph over a label, and the glyph is hidden from assistive technology.
      for (const name of ['Catalog', 'Lists', 'Recordings', 'Settings']) {
        const tab = within(nav).getByRole('link', { name })
        expect(tab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      }
      // Only the current tab is marked, and the mark is what fills its slot.
      const current = within(nav).getByRole('link', { current: 'page' })
      expect(current).toHaveTextContent('Catalog')
      expect(current).toHaveClass('dock-active')
      expect(screen.getByRole('button', { name: 'Start a new recording' })).toHaveClass(
        'min-h-11',
        'min-w-11',
      )
    } finally {
      await db.delete()
    }
  })

  it('opens the recording screen from the record button', async () => {
    const db = openTestDb()
    try {
      const { router } = renderApp({ db })
      await userEvent.click(await screen.findByRole('button', { name: 'Start a new recording' }))
      expect(router.state.location.pathname).toBe('/record')
    } finally {
      await db.delete()
    }
  })
})
