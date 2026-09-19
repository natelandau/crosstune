import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { SectionHeader } from './SectionHeader'

describe('SectionHeader', () => {
  it('renders an h2 with its text', async () => {
    renderIonic(<SectionHeader>Recent recordings</SectionHeader>, { db: openTestDb() })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Recent recordings' }),
    ).toBeInTheDocument()
  })
})
