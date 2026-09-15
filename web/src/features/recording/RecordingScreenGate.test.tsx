import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { renderApp } from '../../test/render'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  stubMediaGlobals()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

describe('RecordingScreen without a prior tap', () => {
  it('shows a start button instead of starting the microphone on its own', async () => {
    renderApp({ db, path: '/record' })
    expect(await screen.findByRole('button', { name: 'Start recording' })).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('starts the take once the start button is tapped', async () => {
    renderApp({ db, path: '/record' })
    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }))
    await screen.findByRole('timer')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
