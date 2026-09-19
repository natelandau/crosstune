import { screen } from '@testing-library/react'
import { Music } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('shows the title and the hint', async () => {
    renderIonic(
      <EmptyState icon={Music} title="No songs yet" hint="Add the first song you know." />,
      {
        db: openTestDb(),
      },
    )
    expect(await screen.findByText('No songs yet')).toBeInTheDocument()
    expect(screen.getByText('Add the first song you know.')).toBeInTheDocument()
  })
})
