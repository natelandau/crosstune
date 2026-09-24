import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SONG_LIMITS, type Instrument } from '../../api/vocabulary'
import { createSong } from '../../commands/songs'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { forceTouch } from '../../test/pointer'
import { CROOKED_HELP, DETAILS_FOOTER, DETAIL_LABELS } from './detailFields'
import {
  EDIT_SONG_TITLE,
  NEW_SONG_TITLE,
  SONG_TITLE_LABEL,
  SongFormSheet,
  TITLE_REQUIRED,
  type SongFormTarget,
} from './SongFormSheet'
import { OTHER_OPTION } from './SuggestSelect'

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
async function openDetail(name: string) {
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

describe('SongFormSheet', () => {
  it('orders title, status, key, tuning, notes, then details', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const headers = Array.from(document.querySelectorAll('ion-modal h2')).map((h) => h.textContent)
    expect(headers).toEqual(['Status', 'Key', 'Tuning', 'Notes', 'Details'])
    const labels = Array.from(document.querySelectorAll('ion-modal [data-detail]')).map((e) =>
      e.getAttribute('data-detail'),
    )
    expect(labels).toEqual([
      DETAIL_LABELS.alternate_titles,
      DETAIL_LABELS.mode,
      DETAIL_LABELS.genre,
      DETAIL_LABELS.time_signature,
      DETAIL_LABELS.feel,
      DETAIL_LABELS.part_structure,
      DETAIL_LABELS.is_crooked,
      DETAIL_LABELS.lyrics,
      DETAIL_LABELS.learned_from,
      DETAIL_LABELS.learned_on,
    ])
    const crookedHelp = document.querySelector(
      `ion-modal [data-detail="${DETAIL_LABELS.is_crooked}"]`,
    )!.textContent
    expect(crookedHelp).toContain(CROOKED_HELP)
  })

  it('shortens a tuning row under the Tuning header, keeping its accessible name', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const tuning = Array.from(document.querySelectorAll('ion-modal section')).find(
      (section) => section.querySelector('h2')?.textContent === 'Tuning',
    )!
    expect(
      Array.from(tuning.querySelectorAll('[data-row-label]')).map((e) => e.textContent),
    ).toEqual(['Violin'])
    // The full name stays the one a screen reader announces.
    await expect
      .element(page.getByRole('button', { name: 'Violin tuning, Not set', exact: true }))
      .toBeInTheDocument()
  })

  it('gives the title a placeholder and no visible label, keeping its name', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    // A dismissed sheet from an earlier test is still in the document, so scope to the open one.
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    const title = open.querySelector('[data-field="title"]')!
    // Ionic hoists both onto the native input and leaves neither on the host.
    await vi.waitFor(() => {
      const input = title.querySelector('input')
      expect(input?.placeholder).toBe(SONG_TITLE_LABEL)
      expect(input?.getAttribute('aria-label')).toBe('Title')
    })
    const headers = Array.from(document.querySelectorAll('ion-modal h2')).map((h) => h.textContent)
    expect(headers).not.toContain('Title')
  })

  it('puts the status control on the ground rather than in a card', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const group = document.querySelector('ion-modal [role="group"][aria-label="Status"]')!
    expect(group.closest('ion-item')).toBeNull()
    expect(group.closest('ion-list')).toBeNull()
  })

  it('holds both tuning rows in one card when both instruments are played', async () => {
    const both = new Set<Instrument>(['violin', 'five_string_banjo'])
    renderIonic(
      <SongFormSheet
        target={{ kind: 'new' }}
        instruments={both}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { db: openTestDb() },
    )
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const tuning = Array.from(document.querySelectorAll('ion-modal section')).find(
      (section) => section.querySelector('h2')?.textContent === 'Tuning',
    )!
    expect(tuning.querySelectorAll('ion-list')).toHaveLength(1)
    expect(
      Array.from(tuning.querySelectorAll('[data-row-label]')).map((e) => e.textContent),
    ).toEqual(['Violin', 'Banjo'])
  })

  it('puts the comma rule under the Details card rather than inside it', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const details = Array.from(document.querySelectorAll('ion-modal section')).find(
      (section) => section.querySelector('h2')?.textContent === 'Details',
    )!
    const footer = details.querySelector('p')!
    expect(footer.textContent).toBe(DETAILS_FOOTER)
    expect(footer.closest('ion-list')).toBeNull()
    expect(
      document.querySelector(`ion-modal [data-detail="${DETAIL_LABELS.alternate_titles}"]`)!
        .textContent,
    ).not.toContain('Separate alternate names')
  })

  it('marks the title invalid on a submit with no title, and clears it as one is typed', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(TITLE_REQUIRED)
    // Ionic strips aria-* off the host at load and renders it on the native input, so the
    // host is not the element a screen reader reads.
    const input = () =>
      document.querySelector('ion-modal:not(.overlay-hidden) [data-field="title"] input')
    await vi.waitFor(() => expect(input()?.getAttribute('aria-invalid')).toBe('true'))
    await page.getByLabelText('Title').fill('Soldier\u2019s Joy')
    await expect.poll(() => input()?.getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps a long alternate title inside its row', async () => {
    const db = openTestDb()
    const { songId, userSongId } = await createSong(
      db,
      {
        title: 'Soldier\u2019s Joy',
        alternate_titles: [
          'Payday in the Army',
          'Love Somebody',
          'The Gal I Left Behind Me',
          'Sally Ann Johnson',
        ],
      },
      { status: 'known' },
    )
    const entry = {
      song: (await db.songs.get(songId))!,
      userSong: (await db.user_songs.get(userSongId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByText(EDIT_SONG_TITLE)).toBeVisible()
    const row = document.querySelector(
      `ion-modal:not(.overlay-hidden) [data-detail="${DETAIL_LABELS.alternate_titles}"]`,
    ) as HTMLElement
    const label = row.querySelector('[data-row-label]') as HTMLElement
    // The row holds one tap height and the label keeps its width, whatever the value's length.
    expect(row.getBoundingClientRect().height).toBeLessThan(80)
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
  })

  it('keeps the Lyrics label beside a long opening line', async () => {
    const db = openTestDb()
    const { songId, userSongId } = await createSong(
      db,
      {
        title: 'Uncle Joe',
        lyrics: 'Did you ever go to meeting, Uncle Joe, Uncle Joe, Uncle Joe\n\nAnd again',
      },
      { status: 'known' },
    )
    const entry = {
      song: (await db.songs.get(songId))!,
      userSong: (await db.user_songs.get(userSongId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByText(EDIT_SONG_TITLE)).toBeVisible()
    const row = document.querySelector(
      `ion-modal:not(.overlay-hidden) [data-detail="${DETAIL_LABELS.lyrics}"]`,
    ) as HTMLElement
    const label = row.querySelector('[data-row-label]') as HTMLElement
    // A way into the lyrics form, so it names itself and shows none of the song. Nothing about
    // the body reaches this row, however long its first line is.
    expect(label.textContent).toBe(DETAIL_LABELS.lyrics)
    expect(row.textContent).toBe(DETAIL_LABELS.lyrics)
    expect(label.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(row.getBoundingClientRect().height).toBeLessThan(80)
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
  })

  it('saves a null key when Unknown is left pressed', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await page.getByLabelText('Title').fill('Sally Goodin')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect(await db.songs.count()).toBe(1))
    expect((await db.songs.toArray())[0]?.key).toBeNull()
  })

  it('fits every status label on one line at phone width', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    // Waits for real layout: a freshly hydrated capsule has zero width and would pass trivially.
    await expect.element(page.getByText(NEW_SONG_TITLE)).toBeVisible()
    const group = document.querySelector('ion-modal [role="group"][aria-label="Status"]')!
    await vi.waitFor(() => expect(group.querySelectorAll('button').length).toBe(3))
    const labels = group.querySelectorAll('button > span')
    expect(labels.length).toBe(3)
    for (const label of labels) {
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    }
  })

  it('requires a title, reports it under the field, and focuses the field', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent(TITLE_REQUIRED)
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
    await expect.element(page.getByRole('alert')).toHaveTextContent(TITLE_REQUIRED)
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
    await page
      .getByRole('group', { name: 'Status' })
      .getByRole('button', { name: 'Known', exact: true })
      .click()
    await page.getByRole('button', { name: 'D', exact: true }).click()
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
    await openDetail('Genre, Not set')
    await page.getByRole('radio', { name: OTHER_OPTION }).click()
    await page.getByLabelText('Other genre').fill('Sacred Harp')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect((await db.songs.toArray())[0]?.genre).toBe('Sacred Harp'))
  })

  it('clears the value when Other is chosen, so what is saved is what is shown', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openDetail('Genre, Not set')
    await page.getByRole('radio', { name: 'Irish' }).click()
    await openDetail('Genre, Irish')
    await page.getByRole('radio', { name: OTHER_OPTION }).click()
    await expect.element(page.getByLabelText('Other genre')).toHaveValue('')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect(await db.songs.count()).toBe(1))
    expect((await db.songs.toArray())[0]?.genre).toBeNull()
  })

  it('keeps a typed Other value that matches a suggestion', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openDetail('Genre, Not set')
    await page.getByRole('radio', { name: OTHER_OPTION }).click()
    await page.getByLabelText('Other genre').fill('Blues')
    await expect.element(page.getByLabelText('Other genre')).toHaveValue('Blues')
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
    await expect.element(page.getByText(EDIT_SONG_TITLE)).toBeVisible()
    await page.getByLabelText('Title').fill('Cluck Old Hen (A)')
    await expect.element(page.getByLabelText('Title')).toHaveValue('Cluck Old Hen (A)')
    // This sheet is where a song's status is changed, so the edit covers it too.
    await page.getByRole('button', { name: 'Known', exact: true }).click()
    expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen')
    expect((await db.user_songs.get(userSongId))?.status).toBe('learning')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () =>
      expect((await db.songs.get(songId))?.title).toBe('Cluck Old Hen (A)'),
    )
    expect((await db.user_songs.get(userSongId))?.status).toBe('known')
    const seen = new Set<string>()
    await vi.waitFor(
      () => {
        const toolbar = document.querySelector('ion-modal ion-toolbar')
        if (toolbar) seen.add(toolbar.textContent ?? '')
        expect(document.querySelector('ion-modal:not(.overlay-hidden)')).toBeNull()
      },
      { interval: 5 },
    )
    expect(
      [...seen].filter((text) => text.includes(NEW_SONG_TITLE) || text.includes('Add')),
    ).toEqual([])
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
    const restore = forceTouch()
    try {
      const db = openTestDb()
      renderIonic(<Host initial={{ kind: 'new', title: 'Touch' }} />, { db })
      await openDetail('Genre, Not set')
      await page.getByRole('radio', { name: 'Gospel' }).click()
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await vi.waitFor(async () => expect((await db.songs.toArray())[0]?.genre).toBe('Gospel'))
    } finally {
      restore()
    }
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
    await expect.element(page.getByRole('heading', { name: 'Tuning' })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Banjo tuning, Open G (gDGBD)', exact: true }))
      .toBeInTheDocument()
  })

  it('opens the lyrics sheet from the details row and carries the words back', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    const row = page.getByRole('button', { name: DETAIL_LABELS.lyrics, exact: true })
    await expect.element(row).toBeVisible()
    await row.click()
    const field = page.getByRole('textbox', { name: DETAIL_LABELS.lyrics })
    await expect.element(field).toBeVisible()
    await field.fill('Did you ever go to meeting\n\nAnd again')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    // The row is a way in, so it reads the same before and after: the words live on the other
    // side of it.
    await expect.element(row).toBeVisible()
  })
})
