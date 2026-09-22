import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { LyricsSheet } from './LyricsSheet'
import { SONG_LIMITS } from '../../api/vocabulary'

function Host({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  const [open, setOpen] = useState(true)
  return (
    <>
      <p data-testid="value">{value}</p>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <LyricsSheet
        open={open}
        value={value}
        onCancel={() => setOpen(false)}
        onSave={(next) => {
          setValue(next)
          setOpen(false)
        }}
      />
    </>
  )
}

const field = () => page.getByRole('textbox', { name: 'Lyrics' })
const modalDismissed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull())

it('hands the typed words back to the host on Done', async () => {
  renderIonic(<Host initial="old words" />, { db: openTestDb() })
  await expect.element(field()).toBeVisible()
  await field().clear()
  await field().fill('new words')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await vi.waitFor(() =>
    expect(document.querySelector('[data-testid="value"]')?.textContent).toBe('new words'),
  )
})

it('discards the draft on cancel and starts fresh from the host value on reopen', async () => {
  renderIonic(<Host initial="old words" />, { db: openTestDb() })
  await expect.element(field()).toBeVisible()
  await field().clear()
  await field().fill('scratch words')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await modalDismissed()
  expect(document.querySelector('[data-testid="value"]')?.textContent).toBe('old words')
  await page.getByRole('button', { name: 'Reopen' }).click()
  await expect.element(field()).toBeVisible()
  await expect.element(field()).toHaveValue('old words')
})

it('caps a body longer than the limit rather than rejecting it', async () => {
  renderIonic(<Host />, { db: openTestDb() })
  await expect.element(field()).toBeVisible()
  await field().fill('x'.repeat(SONG_LIMITS.lyrics + 100))
  await expect.element(field()).toHaveValue('x'.repeat(SONG_LIMITS.lyrics))
})
