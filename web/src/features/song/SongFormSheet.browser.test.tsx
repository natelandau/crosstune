import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createSong } from '../../commands/songs'
import type { Instrument } from '../../db/types'
import { MOUSE_QUERY } from '../../platform/pointer'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { SONG_LIMITS } from './limits'
import { SongFormSheet, type SongFormTarget } from './SongFormSheet'

vi.mock('../../commands/songs', { spy: true })

const violin = new Set<Instrument>(['violin'])

function Host({
  initial,
  onSaved = () => {},
  onClose = () => {},
}: {
  initial: SongFormTarget
  onSaved?: (ids: { songId: string; userSongId: string }) => void
  onClose?: () => void
}) {
  const [target, setTarget] = useState<SongFormTarget | null>(initial)
  return (
    <SongFormSheet
      target={target}
      instruments={violin}
      onClose={() => {
        onClose()
        setTarget(null)
      }}
      onSaved={(ids) => {
        onSaved(ids)
        setTarget(null)
      }}
    />
  )
}

// Ionic ignores a present while the previous popover is still dismissing.
async function openKey(name = 'Key, Not set') {
  await vi.waitFor(() =>
    expect(document.querySelector('ion-popover:not(.overlay-hidden)')).toBeNull(),
  )
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name }) })
    .click()
}

const sheetDismissed = () =>
  vi.waitFor(() => expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull())

const originalMatchMedia = window.matchMedia

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

describe('SongFormSheet', () => {
  it('orders title, status, key, tuning, notes, then details', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText('New song')).toBeVisible()
    const headers = Array.from(document.querySelectorAll('ion-modal h2')).map((h) => h.textContent)
    expect(headers).toEqual(['Title', 'Status', 'Key', 'Violin tuning', 'Notes', 'Details'])
    const labels = Array.from(document.querySelectorAll('ion-modal [data-detail]')).map((e) =>
      e.getAttribute('data-detail'),
    )
    expect(labels).toEqual([
      'Also known as',
      'Mode',
      'Genre',
      'Time signature',
      'Feel',
      'Parts',
      'Crooked',
      'Has lyrics',
      'Learned from',
      'Learned on',
    ])
    const crookedHelp = document.querySelector('ion-modal [data-detail="Crooked"]')!.textContent
    expect(crookedHelp).toContain('An odd number of beats or bars in a part.')
  })

  it('names the key and tuning rows by their group header alone, keeping their accessible names', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText('New song')).toBeVisible()
    for (const name of ['Key', 'Violin tuning']) {
      // ion-select names its shadow button from aria-label plus the shown value.
      await expect
        .element(page.getByRole('button', { name: `${name}, Not set`, exact: true }))
        .toBeInTheDocument()
      const select = Array.from(document.querySelectorAll('ion-modal section'))
        .find((group) => group.querySelector('h2')?.textContent === name)!
        .querySelector('ion-select')!
      await vi.waitFor(() =>
        expect(select.shadowRoot?.querySelector('.select-wrapper')).toBeTruthy(),
      )
      expect(select.shadowRoot!.textContent).not.toContain(name)
      expect(select.textContent).not.toContain(name)
    }
    const mode = document.querySelector('ion-modal [data-detail="Mode"] ion-select')!
    await vi.waitFor(() => expect(mode.shadowRoot?.textContent).toContain('Mode'))
  })

  it('fits every status label on one line at phone width', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    // Waits for real layout: a freshly hydrated label has zero width and would pass trivially.
    await expect.element(page.getByRole('tab', { name: 'Unknown' })).toBeVisible()
    const labels = document.querySelectorAll('ion-segment-button ion-label')
    expect(labels.length).toBe(3)
    for (const label of labels) {
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
    }
  })

  it('requires a title, reports it under the field, and focuses the field', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('A title is required')
    await vi.waitFor(() =>
      expect(document.activeElement?.closest('ion-input')?.getAttribute('data-field')).toBe(
        'title',
      ),
    )
    expect(await db.songs.count()).toBe(0)
  })

  it('clears the title error as the title is typed', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('A title is required')
    await page.getByLabelText('Title').fill('Sally Goodin')
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })

  it('saves when Enter is pressed in a field', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(<Host initial={{ kind: 'new' }} onSaved={onSaved} />, { db })
    await page.getByLabelText('Title').fill('Sally Goodin')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect((await db.songs.toArray())[0]?.title).toBe('Sally Goodin')
  })

  it('creates one song when Enter is pressed twice quickly', async () => {
    const db = openTestDb()
    // Keeps the target until the sheet reports its close, the window a second save could use.
    function KeepingHost() {
      const [target, setTarget] = useState<SongFormTarget | null>({ kind: 'new' })
      return (
        <SongFormSheet
          target={target}
          instruments={violin}
          onClose={() => setTarget(null)}
          onSaved={() => {}}
        />
      )
    }
    renderIonic(<KeepingHost />, { db })
    await page.getByLabelText('Title').fill('Sally Goodin')
    await userEvent.keyboard('{Enter}{Enter}')
    await sheetDismissed()
    await userEvent.keyboard('{Enter}')
    expect(await db.songs.count()).toBe(1)
  })

  it('creates one song from two submits in the same tick', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(<Host initial={{ kind: 'new', title: 'Sally Goodin' }} onSaved={onSaved} />, {
      db,
    })
    await expect.element(page.getByLabelText('Title')).toHaveValue('Sally Goodin')
    const form = document.querySelector('ion-modal form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await db.songs.count()).toBe(1)
  })

  it('saves again when the same target reopens after a save', async () => {
    const db = openTestDb()
    const { songId, userSongId } = await createSong(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'learning' },
    )
    const entry = {
      song: (await db.songs.get(songId))!,
      userSong: (await db.user_songs.get(userSongId))!,
    }
    const target: SongFormTarget = { kind: 'edit', entry }
    function ReopenHost() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <SongFormSheet
            target={open ? target : null}
            instruments={violin}
            onClose={() => setOpen(false)}
            onSaved={() => {}}
          />
        </>
      )
    }
    renderIonic(<ReopenHost />, { db })
    await page.getByLabelText('Title').fill('First edit')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await sheetDismissed()
    await page.getByRole('button', { name: 'Reopen' }).click()
    await page.getByLabelText('Title').fill('Second edit')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () => expect((await db.songs.get(songId))?.title).toBe('Second edit'))
  })

  it('lets a save that failed be tried again', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    vi.mocked(createSong).mockRejectedValueOnce(new Error('Could not save'))
    renderIonic(<Host initial={{ kind: 'new', title: 'Sally Goodin' }} onSaved={onSaved} />, {
      db,
    })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(await db.songs.count()).toBe(1)
  })

  it.each([0, 150, 400])(
    'shows a new target passed %ims into the previous sheet closing',
    async (delay) => {
      const db = openTestDb()
      function NextHost() {
        const [target, setTarget] = useState<SongFormTarget | null>({ kind: 'new', title: 'First' })
        return (
          <SongFormSheet
            target={target}
            instruments={violin}
            onClose={() => setTarget(null)}
            onSaved={() => {
              setTimeout(() => setTarget({ kind: 'new', title: 'Second' }), delay)
            }}
          />
        )
      }
      renderIonic(<NextHost />, { db })
      await expect.element(page.getByLabelText('Title')).toHaveValue('First')
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await vi.waitFor(async () => expect(await db.songs.count()).toBe(1))
      // Long enough for the first sheet to finish dismissing and the second to present.
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await vi.waitFor(() => {
        const shown = document.querySelectorAll('ion-modal.show-modal:not(.overlay-hidden)')
        expect(shown).toHaveLength(1)
        expect(shown[0]!.querySelector<HTMLInputElement>('[data-field="title"] input')?.value).toBe(
          'Second',
        )
      })
    },
  )

  it('creates a song with the typed title and chosen status and key', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(<Host initial={{ kind: 'new', title: "Soldier's Joy" }} onSaved={onSaved} />, {
      db,
    })
    await expect.element(page.getByLabelText('Title')).toHaveValue("Soldier's Joy")
    await page.getByRole('tab', { name: 'Known' }).click({ force: true })
    await openKey()
    await page.getByRole('radio', { name: 'D' }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const [song] = await db.songs.toArray()
    expect(song).toMatchObject({ title: "Soldier's Joy", key: 'D' })
    const [userSong] = await db.user_songs.toArray()
    expect(userSong).toMatchObject({ status: 'known' })
  })

  it('caps a seeded title at the length the server row allows', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(
      <Host
        initial={{ kind: 'new', title: 'a'.repeat(SONG_LIMITS.title + 40) }}
        onSaved={onSaved}
      />,
      { db },
    )
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const [song] = await db.songs.toArray()
    expect(song?.title).toHaveLength(SONG_LIMITS.title)
  })

  it('accepts a value the suggestions lack through Other', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openKey()
    await page.getByRole('radio', { name: 'Other…' }).click()
    await page.getByLabelText('Other key').fill('F#m')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect((await db.songs.toArray())[0]?.key).toBe('F#m'))
  })

  it('clears the value when Other is chosen, so what is saved is what is shown', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openKey()
    await page.getByRole('radio', { name: 'D' }).click()
    await openKey('Key, D')
    await page.getByRole('radio', { name: 'Other…' }).click()
    await expect.element(page.getByLabelText('Other key')).toHaveValue('')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect(await db.songs.count()).toBe(1))
    expect((await db.songs.toArray())[0]?.key).toBeNull()
  })

  it('keeps a typed Other value that matches a suggestion', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openKey()
    await page.getByRole('radio', { name: 'Other…' }).click()
    await page.getByLabelText('Other key').fill('F')
    await expect.element(page.getByLabelText('Other key')).toHaveValue('F')
  })

  it('edits an existing song and saves only on Save', async () => {
    const db = openTestDb()
    const { songId, userSongId } = await createSong(
      db,
      { title: 'Cluck Old Hen', key: 'A' },
      { status: 'learning' },
    )
    const song = (await db.songs.get(songId))!
    const userSong = (await db.user_songs.get(userSongId))!
    renderIonic(<Host initial={{ kind: 'edit', entry: { song, userSong } }} />, { db })
    await expect.element(page.getByText('Edit song')).toBeVisible()
    await page.getByLabelText('Title').fill('Cluck Old Hen (A)')
    await expect.element(page.getByLabelText('Title')).toHaveValue('Cluck Old Hen (A)')
    expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () =>
      expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen (A)'),
    )
    const seen = new Set<string>()
    await vi.waitFor(
      () => {
        const toolbar = document.querySelector('ion-modal ion-toolbar')
        if (toolbar) seen.add(toolbar.textContent ?? '')
        expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
      },
      { interval: 5 },
    )
    expect([...seen].filter((text) => text.includes('New song') || text.includes('Add'))).toEqual(
      [],
    )
  })

  it('discards changes on Cancel and reports the close once', async () => {
    const db = openTestDb()
    const onClose = vi.fn()
    renderIonic(<Host initial={{ kind: 'new' }} onClose={onClose} />, { db })
    await page.getByLabelText('Title').fill('Draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sheetDismissed()
    expect(await db.songs.count()).toBe(0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('picks a suggestion from an action sheet on touch', async () => {
    forceTouch()
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Touch' }} />, { db })
    await openKey()
    await page.getByRole('radio', { name: 'G' }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect((await db.songs.toArray())[0]?.key).toBe('G'))
  })

  it('shows a tuning field for an unplayed instrument when the song already has a value', async () => {
    const db = openTestDb()
    const { songId, userSongId } = await createSong(
      db,
      { title: 'Cripple Creek', banjo_tuning: 'Open G (gDGBD)' },
      { status: 'known' },
    )
    const entry = {
      song: (await db.songs.get(songId))!,
      userSong: (await db.user_songs.get(userSongId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByRole('heading', { name: 'Banjo tuning' })).toBeVisible()
  })
})
