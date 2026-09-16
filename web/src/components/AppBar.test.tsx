import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { renderApp } from '../test/render'

describe('AppBar', () => {
  it('links home through the lockup, named by the app name alone', async () => {
    const db = openTestDb()
    try {
      renderApp({ db })
      const home = await screen.findByRole('link', { name: 'Crosstune' })
      expect(home).toHaveAttribute('href', '/')
      expect(home).toHaveClass('text-brand')
      expect(home.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    } finally {
      db.close()
    }
  })
})
