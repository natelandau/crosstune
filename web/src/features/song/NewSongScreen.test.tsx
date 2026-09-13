import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/render'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  await db.delete()
})

describe('NewSongScreen', () => {
  it('fills the title from the search param', async () => {
    renderApp({ db, path: `/songs/new?title=${encodeURIComponent('Soldier')}` })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('Soldier')
  })

  it('starts with a blank title without the search param', async () => {
    renderApp({ db, path: '/songs/new' })
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue('')
  })
})
