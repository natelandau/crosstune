import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderWithProviders } from '../../test/render'
import { META_LIST_SHOW_ARCHIVED, useListShowArchived } from './useListShowArchived'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

function Probe() {
  const [show, setShow] = useListShowArchived()
  if (show === undefined) return <p>loading</p>
  return (
    <button type="button" onClick={() => void setShow(!show)}>
      {show ? 'shown' : 'hidden'}
    </button>
  )
}

describe('useListShowArchived', () => {
  it('hides archived songs until asked, and saves the choice', async () => {
    renderWithProviders(<Probe />, { db })
    await userEvent.click(await screen.findByRole('button', { name: 'hidden' }))
    expect(await screen.findByRole('button', { name: 'shown' })).toBeInTheDocument()
    await waitFor(async () => expect(await getMeta(db, META_LIST_SHOW_ARCHIVED, null)).toBe(true))
  })
})
