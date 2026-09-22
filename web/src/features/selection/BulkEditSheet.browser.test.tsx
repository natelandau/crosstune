import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { Instrument, SongStatus } from '../../api/vocabulary'
import type { BulkPatch } from '../../commands/bulk'
import { createSong, type SongInput, type UserSongInput } from '../../commands/songs'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import type { CatalogEntry } from '../catalog/filters'
import { TUNING_FIELDS } from '../settings/instruments'
import { DETAIL_LABELS } from '../song/detailFields'
import { BulkEditSheet } from './BulkEditSheet'

const violin = new Set<Instrument>(['violin'])

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

async function seed(
  song: SongInput,
  userSong: Omit<UserSongInput, 'status'> & { status?: SongStatus } = {},
): Promise<CatalogEntry> {
  const { songId, userSongId } = await createSong(db, song, {
    status: 'want_to_learn',
    ...userSong,
  })
  return {
    song: (await db.songs.get(songId))!,
    userSong: (await db.user_songs.get(userSongId))!,
  }
}

function Host({
  entries,
  instruments = violin,
  onApply = () => {},
  error = null,
  pending = false,
}: {
  entries: readonly CatalogEntry[]
  instruments?: ReadonlySet<Instrument>
  onApply?: (patch: BulkPatch) => void
  error?: string | null
  pending?: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
      <BulkEditSheet
        open={open}
        entries={entries}
        instruments={instruments}
        error={error}
        pending={pending}
        onCancel={() => setOpen(false)}
        onApply={onApply}
      />
    </>
  )
}

const sheet = () => document.querySelector<HTMLIonModalElement>('ion-modal')!

const dismissed = () => vi.waitFor(() => expect(sheet().isOpen).toBe(false))

// Ionic ignores a present that lands while the previous popover is still dismissing, and the
// hidden class arrives before the dismissal reaches React, so the wait is for the element to go.
async function openRow(name: string) {
  await vi.waitFor(() => expect(document.querySelector('ion-popover')).toBeNull())
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    .click()
}

const save = () => page.getByRole('button', { name: 'Save', exact: true }).click()

describe('BulkEditSheet', () => {
  it('gives every Details row the shared field shape', async () => {
    const entries = [await seed({ title: 'Say Old Man' }), await seed({ title: 'Lost Indian' })]
    renderIonic(<Host entries={entries} />, { db })
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    const details = Array.from(open.querySelectorAll('section')).find(
      (section) => section.querySelector('h2')?.textContent === 'Details',
    )!
    const rows = Array.from(details.querySelectorAll('ion-item'))
    // Learned from is a text row and Learned on a date row; both read like the select rows.
    for (const label of [DETAIL_LABELS.learned_from, DETAIL_LABELS.learned_on]) {
      const row = rows.find((item) => item.getAttribute('data-detail') === label)
      expect(row?.querySelector('[data-row-label]')?.textContent, label).toBe(label)
    }
  })

  it('reads a shared value on its row', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', key: 'A' }),
      await seed({ title: 'Lost Indian', key: 'A' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect.element(page.getByText('Edit 2 songs')).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Key, A', exact: true }))
      .toBeInTheDocument()
  })

  it('reads Mixed where the songs disagree', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', key: 'A' }),
      await seed({ title: 'Lost Indian', key: 'D' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect
      .element(page.getByRole('button', { name: 'Key, Mixed', exact: true }))
      .toBeInTheDocument()
  })

  it('reads Not set where every song is empty', async () => {
    const entries = [await seed({ title: 'Say Old Man' }), await seed({ title: 'Lost Indian' })]
    renderIonic(<Host entries={entries} />, { db })
    await expect
      .element(page.getByRole('button', { name: 'Key, Not set', exact: true }))
      .toBeInTheDocument()
  })

  it('saves only the rows that were touched', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', key: 'A', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', key: 'A', genre: 'Bluegrass' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Key, A')
    await page.getByRole('radio', { name: 'D', exact: true }).click()
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: { key: 'D' }, userSong: {} })
  })

  it('names the row Mixed and the choice that clears it Clear', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', genre: 'Bluegrass' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect
      .element(page.getByRole('button', { name: 'Genre, Mixed', exact: true }))
      .toBeInTheDocument()
    await openRow('Genre, Mixed')
    await expect.element(page.getByRole('radio', { name: 'Clear', exact: true })).toBeVisible()
    await expect
      .element(page.getByRole('radio', { name: 'Mixed', exact: true }))
      .not.toBeInTheDocument()
  })

  it('clears a field through Clear', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', genre: 'Old-time' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Genre, Old-time')
    await page.getByRole('radio', { name: 'Clear', exact: true }).click()
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: { genre: null }, userSong: {} })
  })

  it('leaves a yes or no row untouched through Keep, never writing a null', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', is_crooked: true }),
      await seed({ title: 'Lost Indian', is_crooked: true }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Crooked, Yes')
    await page.getByRole('radio', { name: 'Keep', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect
      .element(page.getByRole('button', { name: 'Crooked, Yes', exact: true }))
      .toBeInTheDocument()
    await openRow('Crooked, Yes')
    await page.getByRole('radio', { name: 'No', exact: true }).click()
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: { is_crooked: false }, userSong: {} })
  })

  it('says Mixed under a date the songs disagree on', async () => {
    const entries = [
      await seed({ title: 'Say Old Man' }, { learned_on: '2024-03-01' }),
      await seed({ title: 'Lost Indian' }, { learned_on: '2025-06-02' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect.element(page.getByText('Mixed', { exact: true })).toBeVisible()
  })

  it('writes nothing for a mixed row whose Other was opened and left', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', key: 'A', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', key: 'A', genre: 'Bluegrass' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Genre, Mixed')
    await page.getByRole('radio', { name: 'Other\u2026', exact: true }).click()
    await expect.element(page.getByLabelText('Other genre')).toHaveValue('')
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await openRow('Key, A')
    await page.getByRole('radio', { name: 'D', exact: true }).click()
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: { key: 'D' }, userSong: {} })
  })

  it('keeps a shared value behind an opened Other and writes what is typed there', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', genre: 'Old-time' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Genre, Old-time')
    await page.getByRole('radio', { name: 'Other\u2026', exact: true }).click()
    await expect.element(page.getByLabelText('Other genre')).toHaveValue('Old-time')
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await page.getByLabelText('Other genre').fill('Contra')
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: { genre: 'Contra' }, userSong: {} })
  })

  it('never offers Not set for status', async () => {
    const entries = [
      await seed({ title: 'Say Old Man' }, { status: 'known' }),
      await seed({ title: 'Lost Indian' }, { status: 'known' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await openRow('Status, Known')
    await expect.element(page.getByRole('radio', { name: 'Known', exact: true })).toBeVisible()
    const options = Array.from(document.querySelectorAll('ion-popover [role="radio"]')).map(
      (option) => option.textContent?.trim(),
    )
    expect(options).toEqual(['Known', 'Learning', 'Unknown'])
  })

  it('hides a tuning nobody plays and shows one some song already has', async () => {
    const entries = [await seed({ title: 'Say Old Man' }), await seed({ title: 'Lost Indian' })]
    renderIonic(<Host entries={entries} />, { db })
    await expect
      .element(page.getByRole('heading', { name: TUNING_FIELDS.violin_tuning.label }))
      .toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: TUNING_FIELDS.banjo_tuning.label }))
      .not.toBeInTheDocument()
  })

  it('shows a tuning nobody plays when a selected song already has one', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', banjo_tuning: 'Open G (gDGBD)' }),
      await seed({ title: 'Lost Indian' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect
      .element(page.getByRole('heading', { name: TUNING_FIELDS.banjo_tuning.label }))
      .toBeVisible()
  })

  it('opens with fresh rows every time', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', genre: 'Old-time' }),
      await seed({ title: 'Lost Indian', genre: 'Old-time' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await openRow('Genre, Old-time')
    await page.getByRole('radio', { name: 'Bluegrass', exact: true }).click()
    await expect
      .element(page.getByRole('button', { name: 'Genre, Bluegrass', exact: true }))
      .toBeInTheDocument()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dismissed()
    await page.getByRole('button', { name: 'Reopen', exact: true }).click()
    await expect
      .element(page.getByRole('button', { name: 'Genre, Old-time', exact: true }))
      .toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('disables Save until something is touched', async () => {
    const entries = [
      await seed({ title: 'Say Old Man', key: 'A' }),
      await seed({ title: 'Lost Indian', key: 'A' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await openRow('Key, A')
    await page.getByRole('radio', { name: 'D', exact: true }).click()
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  })

  it('leaves the sheet open and shows the message when the caller reports a failure', async () => {
    const entries = [await seed({ title: 'Say Old Man' }), await seed({ title: 'Lost Indian' })]
    renderIonic(<Host entries={entries} error="Disk full" />, { db })
    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(sheet().isOpen).toBe(true)
  })

  it('keeps a trailing space from snapping a text field back to untouched', async () => {
    const entries = [
      await seed({ title: 'Say Old Man' }, { learned_from: 'Bruce Molsky' }),
      await seed({ title: 'Lost Indian' }, { learned_from: 'Bruce Molsky' }),
    ]
    const onApply = vi.fn()
    renderIonic(<Host entries={entries} onApply={onApply} />, { db })
    await expect
      .element(page.getByLabelText(DETAIL_LABELS.learned_from))
      .toHaveValue('Bruce Molsky')
    await page.getByLabelText(DETAIL_LABELS.learned_from).fill('Bruce Molsky ')
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await save()
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledOnce())
    expect(onApply).toHaveBeenCalledWith({ song: {}, userSong: { learned_from: 'Bruce Molsky' } })
  })

  it('ignores a half-typed date', async () => {
    const entries = [
      await seed({ title: 'Say Old Man' }, { learned_on: '2024-03-01' }),
      await seed({ title: 'Lost Indian' }, { learned_on: '2024-03-01' }),
    ]
    renderIonic(<Host entries={entries} />, { db })
    await expect.element(page.getByLabelText(DETAIL_LABELS.learned_on)).toHaveValue('2024-03-01')
    await page.getByLabelText(DETAIL_LABELS.learned_on).click()
    // Clears one part of the date, which is how a date reads mid-edit: empty, but not blank.
    await userEvent.keyboard('{Backspace}')
    const input = page.getByLabelText(DETAIL_LABELS.learned_on).element() as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.validity.badInput).toBe(true)
    await expect.element(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  })
})
