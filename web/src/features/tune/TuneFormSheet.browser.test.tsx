import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { TUNE_LIMITS, type Instrument } from '../../api/vocabulary'
import { createTune } from '../../commands/tunes'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { forceTouch } from '../../test/pointer'
import { tuneRow, userTuneRow } from '../../test/rows'
import { NOT_SET } from '../../ui/FieldRow'
import {
  ADD_PART_MODE,
  CROOKED_HELP,
  DETAILS_FOOTER,
  DETAIL_LABELS,
  PART_MODE_LABELS,
} from './detailFields'
import {
  EDIT_TUNE_TITLE,
  NEW_TUNE_TITLE,
  TUNE_TITLE_LABEL,
  TuneFormSheet,
  TITLE_REQUIRED,
  type TuneFormTarget,
} from './TuneFormSheet'
import { OTHER_OPTION } from './SuggestSelect'

vi.mock('../../commands/tunes', { spy: true })

const violin = new Set<Instrument>(['violin'])

function Host({
  initial,
  onSaved = () => {},
  onClose = () => {},
}: {
  initial: TuneFormTarget
  onSaved?: (ids: { tuneId: string; userTuneId: string }) => void
  onClose?: () => void
}) {
  const [target, setTarget] = useState<TuneFormTarget | null>(initial)
  return (
    <TuneFormSheet
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

describe('TuneFormSheet', () => {
  it('orders title, status, key, tuning, notes, then details', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    const headers = Array.from(document.querySelectorAll('ion-modal h2')).map((h) => h.textContent)
    expect(headers).toEqual(['Status', 'Key', 'Tuning', 'Notes', 'Details'])
    const labels = Array.from(document.querySelectorAll('ion-modal [data-detail]')).map((e) =>
      e.getAttribute('data-detail'),
    )
    expect(labels).toEqual([
      DETAIL_LABELS.alternate_titles,
      DETAIL_LABELS.composer,
      DETAIL_LABELS.mode,
      DETAIL_LABELS.genre,
      DETAIL_LABELS.tune_type,
      DETAIL_LABELS.time_signature,
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
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
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
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    // A dismissed sheet from an earlier test is still in the document, so scope to the open one.
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    const title = open.querySelector('[data-field="title"]')!
    // Ionic hoists both onto the native input and leaves neither on the host.
    await vi.waitFor(() => {
      const input = title.querySelector('input')
      expect(input?.placeholder).toBe(TUNE_TITLE_LABEL)
      expect(input?.getAttribute('aria-label')).toBe('Title')
    })
    const headers = Array.from(document.querySelectorAll('ion-modal h2')).map((h) => h.textContent)
    expect(headers).not.toContain('Title')
  })

  it('puts the status control on the ground rather than in a card', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    const group = document.querySelector('ion-modal [role="group"][aria-label="Status"]')!
    expect(group.closest('ion-item')).toBeNull()
    expect(group.closest('ion-list')).toBeNull()
  })

  it('holds every tuning and capo row in one card', async () => {
    const both = new Set<Instrument>(['violin', 'five_string_banjo'])
    renderIonic(
      <TuneFormSheet
        target={{ kind: 'new' }}
        instruments={both}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { db: openTestDb() },
    )
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    const tuning = Array.from(document.querySelectorAll('ion-modal section')).find(
      (section) => section.querySelector('h2')?.textContent === 'Tuning',
    )!
    expect(tuning.querySelectorAll('ion-list')).toHaveLength(1)
    expect(
      Array.from(tuning.querySelectorAll('[data-row-label]')).map((e) => e.textContent),
    ).toEqual(['Violin', '5-string banjo', '5-string banjo capo'])
  })

  it('offers a capo for a fretted instrument and none for violin', async () => {
    renderIonic(
      <TuneFormSheet
        target={{ kind: 'new' }}
        instruments={new Set<Instrument>(['violin', 'guitar'])}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { db: openTestDb() },
    )
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'Guitar capo, None', exact: true }))
      .toBeInTheDocument()
    expect(page.getByRole('button', { name: /^Violin capo/ }).elements()).toHaveLength(0)
  })

  it('saves a capo with no tuning', async () => {
    const db = openTestDb()
    renderIonic(
      <TuneFormSheet
        target={{ kind: 'new', title: 'Capo tune' }}
        instruments={new Set<Instrument>(['guitar'])}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { db },
    )
    await openDetail('Guitar capo, None')
    await page.getByRole('radio', { name: '2', exact: true }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () =>
      expect((await db.tunes.toArray())[0]?.tunings).toEqual({ guitar: { capo: 2 } }),
    )
  })

  it('keeps a stored capo with no tuning through a save', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Capo tune', tunings: { guitar: { capo: 3 } } },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(
      <TuneFormSheet
        target={{ kind: 'edit', entry }}
        instruments={new Set<Instrument>()}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { db },
    )
    await expect
      .element(page.getByRole('button', { name: 'Guitar tuning, Not set', exact: true }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'Guitar capo, 3', exact: true }))
      .toBeInTheDocument()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () =>
      expect((await db.tunes.get(tuneId))?.updated_at).not.toBe(entry.tune.updated_at),
    )
    expect((await db.tunes.get(tuneId))!.tunings).toEqual({ guitar: { capo: 3 } })
  })

  it('keeps a pulled tuning for an instrument this client does not know through a save', async () => {
    const db = openTestDb()
    const tunings = { hardanger: { tuning: 'AEAC#' }, violin: { tuning: 'Cross A (AEAE)' } }
    await db.tunes.put(tuneRow('s1', 'Hardanger tune', { tunings }))
    await db.user_tunes.put(userTuneRow('u1', 's1'))
    const entry = {
      tune: (await db.tunes.get('s1'))!,
      userTune: (await db.user_tunes.get('u1'))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByText(EDIT_TUNE_TITLE)).toBeVisible()
    await page.getByLabelText('Title').fill('Hardanger tune (A)')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await sheetDismissed()
    expect((await db.tunes.get('s1'))!.tunings).toEqual(tunings)
  })

  it('puts the comma rule under the Details card rather than inside it', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
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
    const { tuneId, userTuneId } = await createTune(
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
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByText(EDIT_TUNE_TITLE)).toBeVisible()
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
    const { tuneId, userTuneId } = await createTune(
      db,
      {
        title: 'Uncle Joe',
        lyrics: 'Did you ever go to meeting, Uncle Joe, Uncle Joe, Uncle Joe\n\nAnd again',
      },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByText(EDIT_TUNE_TITLE)).toBeVisible()
    const row = document.querySelector(
      `ion-modal:not(.overlay-hidden) [data-detail="${DETAIL_LABELS.lyrics}"]`,
    ) as HTMLElement
    const label = row.querySelector('[data-row-label]') as HTMLElement
    // A way into the lyrics form, so it names itself and shows none of the tune. Nothing about
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
    await vi.waitFor(async () => expect(await db.tunes.count()).toBe(1))
    expect((await db.tunes.toArray())[0]?.key).toBeNull()
  })

  it('fits every status label on one line at phone width', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    // Waits for real layout: a freshly hydrated capsule has zero width and would pass trivially.
    await expect.element(page.getByText(NEW_TUNE_TITLE)).toBeVisible()
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
    expect(await db.tunes.count()).toBe(0)
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
    expect((await db.tunes.toArray())[0]?.title).toBe('Sally Goodin')
  })

  it('creates one tune when Enter is pressed twice quickly', async () => {
    const db = openTestDb()
    // Keeps the target until the sheet reports its close, the window a second save could use.
    function KeepingHost() {
      const [target, setTarget] = useState<TuneFormTarget | null>({ kind: 'new' })
      return (
        <TuneFormSheet
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
    expect(await db.tunes.count()).toBe(1)
  })

  it('creates one tune from two submits in the same tick', async () => {
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
    expect(await db.tunes.count()).toBe(1)
  })

  it('saves again when the same target reopens after a save', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Cluck Old Hen' },
      { status: 'learning' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    const target: TuneFormTarget = { kind: 'edit', entry }
    function ReopenHost() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <TuneFormSheet
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
    await vi.waitFor(async () => expect((await db.tunes.get(tuneId))?.title).toBe('Second edit'))
  })

  it('lets a save that failed be tried again', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    vi.mocked(createTune).mockRejectedValueOnce(new Error('Could not save'))
    renderIonic(<Host initial={{ kind: 'new', title: 'Sally Goodin' }} onSaved={onSaved} />, {
      db,
    })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(await db.tunes.count()).toBe(1)
  })

  it.each([0, 150, 400])(
    'shows a new target passed %ims into the previous sheet closing',
    async (delay) => {
      const db = openTestDb()
      function NextHost() {
        const [target, setTarget] = useState<TuneFormTarget | null>({ kind: 'new', title: 'First' })
        return (
          <TuneFormSheet
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
      await vi.waitFor(async () => expect(await db.tunes.count()).toBe(1))
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

  it('creates a tune with the typed title and chosen status and key', async () => {
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
    const [tune] = await db.tunes.toArray()
    expect(tune).toMatchObject({ title: "Soldier's Joy", key: 'D' })
    const [userTune] = await db.user_tunes.toArray()
    expect(userTune).toMatchObject({ status: 'known' })
  })

  it('caps a seeded title at the length the server row allows', async () => {
    const db = openTestDb()
    const onSaved = vi.fn()
    renderIonic(
      <Host
        initial={{ kind: 'new', title: 'a'.repeat(TUNE_LIMITS.title + 40) }}
        onSaved={onSaved}
      />,
      { db },
    )
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const [tune] = await db.tunes.toArray()
    expect(tune?.title).toHaveLength(TUNE_LIMITS.title)
  })

  it('accepts a value the suggestions lack through Other', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openDetail('Genre, Not set')
    await page.getByRole('radio', { name: OTHER_OPTION }).click()
    await page.getByLabelText('Other genre').fill('Sacred Harp')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await vi.waitFor(async () => expect((await db.tunes.toArray())[0]?.genre).toBe('Sacred Harp'))
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
    await vi.waitFor(async () => expect(await db.tunes.count()).toBe(1))
    expect((await db.tunes.toArray())[0]?.genre).toBeNull()
  })

  it('keeps a typed Other value that matches a suggestion', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'Odd' }} />, { db })
    await openDetail('Genre, Not set')
    await page.getByRole('radio', { name: OTHER_OPTION }).click()
    await page.getByLabelText('Other genre').fill('Blues')
    await expect.element(page.getByLabelText('Other genre')).toHaveValue('Blues')
  })

  it('edits an existing tune and saves only on Save', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Cluck Old Hen', key: 'A' },
      { status: 'learning' },
    )
    const tune = (await db.tunes.get(tuneId))!
    const userTune = (await db.user_tunes.get(userTuneId))!
    renderIonic(<Host initial={{ kind: 'edit', entry: { tune, userTune } }} />, { db })
    await expect.element(page.getByText(EDIT_TUNE_TITLE)).toBeVisible()
    await page.getByLabelText('Title').fill('Cluck Old Hen (A)')
    await expect.element(page.getByLabelText('Title')).toHaveValue('Cluck Old Hen (A)')
    // This sheet is where a tune's status is changed, so the edit covers it too.
    await page.getByRole('button', { name: 'Known', exact: true }).click()
    expect((await db.tunes.get(tuneId))?.title).toBe('Cluck Old Hen')
    expect((await db.user_tunes.get(userTuneId))?.status).toBe('learning')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await vi.waitFor(async () =>
      expect((await db.tunes.get(tuneId))?.title).toBe('Cluck Old Hen (A)'),
    )
    expect((await db.user_tunes.get(userTuneId))?.status).toBe('known')
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
      [...seen].filter((text) => text.includes(NEW_TUNE_TITLE) || text.includes('Add')),
    ).toEqual([])
  })

  it('discards changes on Cancel and reports the close once', async () => {
    const db = openTestDb()
    const onClose = vi.fn()
    renderIonic(<Host initial={{ kind: 'new' }} onClose={onClose} />, { db })
    await page.getByLabelText('Title').fill('Draft')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sheetDismissed()
    expect(await db.tunes.count()).toBe(0)
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
      await vi.waitFor(async () => expect((await db.tunes.toArray())[0]?.genre).toBe('Gospel'))
    } finally {
      restore()
    }
  })

  it('shows a tuning field for an unplayed instrument when the tune already has a value', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Cripple Creek', tunings: { five_string_banjo: { tuning: 'Open G (gDGBD)' } } },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect.element(page.getByRole('heading', { name: 'Tuning' })).toBeVisible()
    await expect
      .element(
        page.getByRole('button', { name: '5-string banjo tuning, Open G (gDGBD)', exact: true }),
      )
      .toBeInTheDocument()
  })

  it('offers 3/2 as a time signature choice', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await openDetail('Time signature, 4/4')
    await expect.element(page.getByRole('radio', { name: '3/2', exact: true })).toBeVisible()
  })

  it('still shows a tune stored with 3/2 on the form', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'Midnight on the Water', time_signature: '3/2' },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await expect
      .element(page.getByRole('button', { name: 'Time signature, 3/2', exact: true }))
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

  it('shows Genre above Type', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    const genre = page.getByRole('button', { name: `${DETAIL_LABELS.genre}, ${NOT_SET}` })
    const type = page.getByRole('button', { name: `${DETAIL_LABELS.tune_type}, ${NOT_SET}` })
    await expect.element(genre).toBeInTheDocument()
    const order = genre.element().compareDocumentPosition(type.element())
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('adds a B part mode row once the first mode is set', async () => {
    renderIonic(<Host initial={{ kind: 'new' }} />, { db: openTestDb() })
    await expect.element(page.getByRole('button', { name: ADD_PART_MODE })).not.toBeInTheDocument()
    await openDetail(`${PART_MODE_LABELS[0]}, ${NOT_SET}`)
    await page.getByRole('radio', { name: 'dorian' }).click()
    await page.getByRole('button', { name: ADD_PART_MODE }).click()
    await expect
      .element(page.getByRole('button', { name: `${PART_MODE_LABELS[1]}, ${NOT_SET}` }))
      .toBeInTheDocument()
  })

  it('keeps the B part row when the first mode is cleared, and saves no gap', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: "Cooley's", modes: ['major', 'minor'] },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await openDetail(`${PART_MODE_LABELS[0]}, major`)
    await page.getByRole('radio', { name: NOT_SET }).click()
    await expect
      .element(page.getByRole('button', { name: `${PART_MODE_LABELS[0]}, ${NOT_SET}` }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: `${PART_MODE_LABELS[1]}, minor` }))
      .toBeInTheDocument()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await sheetDismissed()
    expect((await db.tunes.get(tuneId))?.modes).toEqual(['minor'])
  })

  it('keeps both part modes through a save that never touches them', async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: "Cooley's", modes: ['major', 'dorian'] },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await page.getByLabelText('Title').fill("Cooley's Reel")
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await sheetDismissed()
    const saved = await db.tunes.get(tuneId)
    expect(saved?.title).toBe("Cooley's Reel")
    expect(saved?.modes).toEqual(['major', 'dorian'])
  })

  it('fills 6/8 when a new tune is given the Jig type', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'The Kesh' }} />, { db })
    await expect
      .element(page.getByRole('button', { name: `${DETAIL_LABELS.time_signature}, 4/4` }))
      .toBeInTheDocument()
    await openDetail(`${DETAIL_LABELS.tune_type}, ${NOT_SET}`)
    await page.getByRole('radio', { name: 'Jig', exact: true }).click()
    await expect
      .element(page.getByRole('button', { name: `${DETAIL_LABELS.time_signature}, 6/8` }))
      .toBeInTheDocument()
  })

  // The select shows a pick before the form's state holds it, so these read the saved row.
  it('keeps a time signature the player set when a new tune is given a type', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'The Kesh' }} />, { db })
    await openDetail(`${DETAIL_LABELS.time_signature}, 4/4`)
    await page.getByRole('radio', { name: '3/4', exact: true }).click()
    await openDetail(`${DETAIL_LABELS.tune_type}, ${NOT_SET}`)
    await page.getByRole('radio', { name: 'Jig', exact: true }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await sheetDismissed()
    expect((await db.tunes.toArray())[0]).toMatchObject({ tune_type: 'Jig', time_signature: '3/4' })
  })

  it('keeps 4/4 on a new tune once the player picks it, though it was already set', async () => {
    const db = openTestDb()
    renderIonic(<Host initial={{ kind: 'new', title: 'The Kesh' }} />, { db })
    await openDetail(`${DETAIL_LABELS.time_signature}, 4/4`)
    await page.getByRole('radio', { name: '4/4', exact: true }).click()
    await openDetail(`${DETAIL_LABELS.tune_type}, ${NOT_SET}`)
    await page.getByRole('radio', { name: 'Jig', exact: true }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await sheetDismissed()
    expect((await db.tunes.toArray())[0]).toMatchObject({ tune_type: 'Jig', time_signature: '4/4' })
  })

  it("keeps an edited tune's stored 4/4 when it is given the Jig type", async () => {
    const db = openTestDb()
    const { tuneId, userTuneId } = await createTune(
      db,
      { title: 'The Kesh', time_signature: '4/4' },
      { status: 'known' },
    )
    const entry = {
      tune: (await db.tunes.get(tuneId))!,
      userTune: (await db.user_tunes.get(userTuneId))!,
    }
    renderIonic(<Host initial={{ kind: 'edit', entry }} />, { db })
    await openDetail(`${DETAIL_LABELS.tune_type}, ${NOT_SET}`)
    await page.getByRole('radio', { name: 'Jig', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await sheetDismissed()
    expect(await db.tunes.get(tuneId)).toMatchObject({ tune_type: 'Jig', time_signature: '4/4' })
  })

  it('defaults a new tune to the most-used genre', async () => {
    const db = openTestDb()
    for (const genre of ['Irish', 'Irish', 'Old-time']) {
      await createTune(db, { title: `A ${genre} tune`, genre }, { status: 'known' })
    }
    renderIonic(<Host initial={{ kind: 'new' }} />, { db })
    await expect
      .element(page.getByRole('button', { name: `${DETAIL_LABELS.genre}, Irish` }))
      .toBeInTheDocument()
  })

  it('suggests the catalog composers after Trad.', async () => {
    const db = openTestDb()
    await createTune(db, { title: 'Lucy Farr', composer: 'Ed Reavy' }, { status: 'known' })
    renderIonic(<Host initial={{ kind: 'new', title: 'The Kesh' }} />, { db })
    await openDetail(`${DETAIL_LABELS.composer}, ${NOT_SET}`)
    await expect.element(page.getByRole('radio', { name: 'Ed Reavy' })).toBeVisible()
    await page.getByRole('radio', { name: 'Trad.' }).click()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await sheetDismissed()
    const created = (await db.tunes.toArray()).find((t) => t.title === 'The Kesh')
    expect(created?.composer).toBe('Trad.')
  })
})
