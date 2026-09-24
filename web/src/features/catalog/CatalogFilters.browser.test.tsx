import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { CatalogFilterSheet, SHOW_ARCHIVED } from './CatalogFilterSheet'
import { ALL_KEYS_LABEL, CatalogFilters } from './CatalogFilters'
import {
  DEFAULT_FILTERS,
  FACET_LABELS,
  facetValues,
  type CatalogFilters as Filters,
  type Facet,
  type FacetValues,
} from './filters'

const facets: FacetValues = {
  ...facetValues([]),
  key: ['A', 'D'],
  mode: ['major'],
  'tuning:violin': ['Standard (GDAE)'],
  genre: ['Old-time'],
}
const visible: Facet[] = ['key', 'mode', 'tuning:violin', 'genre']
const counts = { visible: 3, total: 5, archived: 2, all: 7 }

function Host({
  start = DEFAULT_FILTERS,
  sheet = false,
  keys,
}: {
  start?: Filters
  sheet?: boolean
  /** Overrides the key facet, for a rail that holds two spellings of one pitch. */
  keys?: string[]
}) {
  const [filters, setFilters] = useState(start)
  const [open, setOpen] = useState(sheet)
  const onChange = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const railFacets = keys ? { ...facets, key: keys } : facets
  return (
    <>
      <output data-testid="state">{JSON.stringify(filters)}</output>
      <CatalogFilters filters={filters} facets={railFacets} visible={visible} onChange={onChange} />
      <CatalogFilterSheet
        open={open}
        filters={filters}
        facets={facets}
        visible={visible}
        counts={counts}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

const state = () =>
  JSON.parse(document.querySelector('[data-testid=state]')!.textContent!) as Filters

const manyKeys = ['A', 'A♭', 'B', 'C', 'C♯', 'D', 'D♭', 'E', 'E♭', 'F', 'F♯', 'G', 'G♭']
const manyKeyFacets: FacetValues = { ...facets, key: manyKeys }

function ManyKeysHost() {
  return (
    <CatalogFilters
      filters={DEFAULT_FILTERS}
      facets={manyKeyFacets}
      visible={visible}
      onChange={() => {}}
    />
  )
}

async function railElement() {
  const rail = document.querySelector<HTMLElement>('[role=group][aria-label=Key]')!
  await expect.element(page.getByRole('group', { name: 'Key' })).toBeVisible()
  return rail
}

/**
 * No status label, including "Unknown", is clipped, and the four capsules stay on one line, at
 * phone width.
 */
async function expectNoStatusLabelOverflow() {
  // Waits for real layout: a freshly hydrated label has zero width and would pass trivially.
  await expect.element(page.getByRole('button', { name: 'Unknown', exact: true })).toBeVisible()
  const group = document.querySelector('[role="group"][aria-label="Status"]') as HTMLElement
  const buttons = [...group.querySelectorAll('button')]
  expect(buttons.length).toBe(4)
  for (const button of buttons) {
    const label = button.querySelector(':scope > span')!
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
  }
  // One line, whatever the text size: a capsule past the edge scrolls into reach rather than
  // dropping onto a second row.
  const tops = new Set(buttons.map((button) => button.offsetTop))
  expect(tops.size).toBe(1)
}

describe('CatalogFilters', () => {
  it('fits every status label on one line at phone width', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expectNoStatusLabelOverflow()
  })

  it('scales the status labels with the roomy text size and still fits them', async () => {
    document.documentElement.dataset.textSize = 'roomy'
    try {
      renderIonic(<Host />, { db: openTestDb() })
      await expectNoStatusLabelOverflow()
    } finally {
      delete document.documentElement.dataset.textSize
    }
  })

  it('shows no fade on the key rail when the keys do not overflow it', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    const rail = await railElement()
    await vi.waitFor(() => expect(rail.scrollWidth).toBeGreaterThan(0))
    expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth)
    expect(getComputedStyle(rail).maskImage).toBe('none')
  })

  it('fades the key rail at its inline end and clears the fade once scrolled there', async () => {
    renderIonic(<ManyKeysHost />, { db: openTestDb() })
    const rail = await railElement()
    await vi.waitFor(() =>
      expect(getComputedStyle(rail).maskImage).toMatch(/^linear-gradient\(to right, /),
    )
    rail.scrollLeft = rail.scrollWidth - rail.clientWidth
    await vi.waitFor(() => expect(getComputedStyle(rail).maskImage).toBe('none'))
  })

  it('fades the key rail from its inline end in RTL and clears it once scrolled there', async () => {
    renderIonic(
      <div dir="rtl">
        <ManyKeysHost />
      </div>,
      { db: openTestDb() },
    )
    const rail = await railElement()
    await vi.waitFor(() =>
      expect(getComputedStyle(rail).maskImage).toMatch(/^linear-gradient\(to left, /),
    )
    rail.scrollLeft = -(rail.scrollWidth - rail.clientWidth)
    await vi.waitFor(() => expect(getComputedStyle(rail).maskImage).toBe('none'))
  })

  it('sets status from the status capsules', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await page.getByRole('button', { name: 'Learning', exact: true }).click()
    await expect.poll(() => state().status).toBe('learning')
  })

  it('sets a key in one tap and clears it from All keys or the pressed key', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    const d = page.getByRole('button', { name: 'D', exact: true })
    // The reset capsule names what the rail filters, so the bare letters beside it read as keys.
    const allKeys = page.getByRole('button', { name: ALL_KEYS_LABEL, exact: true })
    await d.click()
    await expect.poll(() => state().key).toBe('D')
    await expect.element(d).toHaveAttribute('aria-pressed', 'true')
    await allKeys.click()
    await expect.poll(() => state().key).toBe('all')
    await expect.element(allKeys).toHaveAttribute('aria-pressed', 'true')
    await d.click()
    await expect.poll(() => state().key).toBe('D')
    await d.click()
    await expect.poll(() => state().key).toBe('all')
  })

  it('colors every key in the rail and fills the chosen one in its own hue', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    const pill = () => document.querySelector('.key-pill[data-pitch="2"]')!
    await expect.element(page.getByRole('button', { name: 'D', exact: true })).toBeVisible()
    expect(pill().hasAttribute('data-chosen')).toBe(false)
    const resting = getComputedStyle(pill()).backgroundColor
    await page.getByRole('button', { name: 'D', exact: true }).click()
    await expect.poll(() => state().key).toBe('D')
    await expect.poll(() => pill().hasAttribute('data-chosen')).toBe(true)
    expect(getComputedStyle(pill()).backgroundColor).not.toBe(resting)
    await expect
      .element(page.getByRole('button', { name: 'D', exact: true }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('gives two spellings of one pitch the same hue', async () => {
    renderIonic(<Host keys={['Bb', 'A#']} />, { db: openTestDb() })
    await expect.element(page.getByRole('button', { name: 'Bb', exact: true })).toBeVisible()
    const pills = document.querySelectorAll('.key-pill[data-pitch="10"]')
    expect(pills).toHaveLength(2)
    expect(getComputedStyle(pills[0]!).backgroundColor).toBe(
      getComputedStyle(pills[1]!).backgroundColor,
    )
  })

  it('shows a set sheet filter as a removable pill, and Archived shown', async () => {
    renderIonic(<Host start={{ ...DEFAULT_FILTERS, mode: 'major', archived: true }} />, {
      db: openTestDb(),
    })
    const pill = page.getByRole('button', { name: 'Remove filter major' })
    // A pill removes a filter; it is not a toggle, so it never announces aria-pressed.
    await expect.element(pill).not.toHaveAttribute('aria-pressed')
    await pill.click()
    await expect.poll(() => state().mode).toBe('all')
    await page.getByRole('button', { name: 'Remove filter Archived shown' }).click()
    await expect.poll(() => state().archived).toBe(false)
  })
})

describe('CatalogFilterSheet', () => {
  it('gives each facet row the shared field shape and the text inset', async () => {
    renderIonic(<Host sheet />, { db: openTestDb() })
    await expect.element(page.getByText('Filters')).toBeVisible()
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    const labels = Array.from(open.querySelectorAll('[data-row-label]')).map((e) => e.textContent)
    expect(labels).toEqual(['Mode', FACET_LABELS['tuning:violin'], 'Genre'])
    const count = open.querySelector('[aria-live="polite"]') as HTMLElement
    expect(Number.parseFloat(getComputedStyle(count).paddingLeft)).toBe(32)
  })

  it('shows the live count, a select per sheet facet, and the archived switch with its count', async () => {
    renderIonic(<Host sheet />, { db: openTestDb() })
    await expect.element(page.getByText('3 of 5 tunes')).toBeVisible()
    // IonSelect's accessible name is "<label>, <value>", and its own button is clipped, so
    // visibility is asserted on the row that contains it.
    for (const label of ['Mode', FACET_LABELS['tuning:violin'], 'Genre']) {
      await expect
        .element(
          page.getByRole('listitem').filter({ has: page.getByLabelText(label, { exact: false }) }),
        )
        .toBeVisible()
    }
    // Scoped to the sheet: the catalog's own Key rail is also labeled "Key".
    expect(page.getByRole('dialog').getByLabelText('Key').elements()).toHaveLength(0)
    await expect.element(page.getByText('2 archived tunes')).toBeVisible()
    // The archived count is tabular, like every other count in the catalog.
    expect(document.querySelector('ion-modal p.type-footnote span')).toHaveClass('tabular-nums')
  })

  it('shows a stale sheet-facet value that is no longer in the facet list', async () => {
    renderIonic(<Host sheet start={{ ...DEFAULT_FILTERS, mode: 'minor' }} />, {
      db: openTestDb(),
    })
    await expect
      .element(
        page
          .getByRole('listitem')
          .filter({ has: page.getByLabelText('Mode, minor', { exact: false }) }),
      )
      .toBeVisible()
  })

  it('applies a change at once and resets only the sheet filters', async () => {
    renderIonic(<Host sheet start={{ ...DEFAULT_FILTERS, status: 'known', key: 'D' }} />, {
      db: openTestDb(),
    })
    await page.getByRole('switch', { name: SHOW_ARCHIVED }).click()
    await expect.poll(() => state().archived).toBe(true)
    await page.getByRole('button', { name: 'Reset' }).click()
    await expect.poll(() => state()).toMatchObject({ archived: false, status: 'known', key: 'D' })
  })

  it('toggles archived from a tap anywhere on its 44px row, including the label text', async () => {
    renderIonic(<Host sheet />, { db: openTestDb() })
    await vi.waitFor(() => {
      const row = document.querySelector('ion-item:has(ion-toggle)')
      expect(row?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    })
    await page.getByText(SHOW_ARCHIVED).click()
    await expect.poll(() => state().archived).toBe(true)
  })
})
