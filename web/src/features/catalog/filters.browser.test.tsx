import { MotionConfig } from 'motion/react'
import { expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { setInstruments } from '../../commands/settings'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import { getMeta, setMeta } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { NO_TUNES_TITLE, SHOW_ARCHIVED, TUNE_LIST } from './catalogCopy'
import { ARCHIVED_SHOWN, facetControlLabel, MISSING_LABEL, sheetFilters } from './filterLabels'
import {
  DEFAULT_FILTERS,
  FACETS,
  FACET_LABELS,
  META_CATALOG_FILTERS,
  MISSING_LABELS,
  normalizeFilters,
  ROW_FACETS,
  type CatalogFilters,
  type Facet,
  type FacetValues,
} from './filters'
import { countTunes } from '../selection/copy'
import { withInstrumentLabel } from '../settings/instruments'
import { openTestDb } from '../../test/db'
import { DONE } from '../../ui/confirmCopy'
import { ANY, FILTERS, filtersLabel, RESET, removeFilterLabel } from '../../ui/filterCopy'
import { KEY } from '../../ui/keyName'
import { destination } from '../../app/destinations'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { CatalogFilterRow, FILTER_ROW } from './CatalogFilterRow'

import { statusControlLabel } from './scope'

const CATALOG = destination('catalog').label

const CROSS_A = 'Cross A (AEAE)'

async function seed(db: CrosstuneDb, filters: Partial<CatalogFilters> = {}) {
  await createTune(db, { title: "Soldier's Joy", key: 'D', tune_type: 'reel' }, { status: 'known' })
  await createTune(
    db,
    {
      title: "Bonaparte's Retreat",
      key: 'A',
      tune_type: 'reel',
      tunings: { violin: { tuning: CROSS_A } },
    },
    { status: 'known' },
  )
  await createTune(
    db,
    {
      title: 'Midnight on the Water',
      key: 'D',
      tune_type: 'waltz',
      composer: 'Benny Thomasson',
    },
    { status: 'known' },
  )
  await createTune(
    db,
    { title: 'Ookpik Waltz', key: 'Bb', tune_type: 'waltz' },
    { status: 'known' },
  )
  await setInstruments(db, 'user_1', ['violin'])
  await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, ...filters })
}

async function mount(db: CrosstuneDb, density: 'pointer' | 'touch' = 'pointer') {
  return renderApp({
    path: '/catalog',
    db,
    density,
    launcher: { open: () => {} },
  })
}

const stored = async (db: CrosstuneDb) =>
  normalizeFilters(await getMeta(db, META_CATALOG_FILTERS, null))

const filterRow = () => page.getByRole('group', { name: FILTER_ROW })
const control = (name: string) => filterRow().getByRole('button', { name, exact: true })
const rowTitles = () =>
  page
    .getByRole('grid', { name: TUNE_LIST })
    .getByRole('row')
    .elements()
    .map((e) => e.querySelector('[data-row-title]')?.textContent)
const keyOption = (name: string) => page.getByRole('option', { name, exact: true })

it('narrows by key from the key popover, and Any clears it', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await control(facetControlLabel('key', 'all')).click()
  const popover = page.getByRole('dialog', { name: KEY })
  await expect.element(popover).toBeVisible()
  // The filter offers the keys the catalog holds, not every key there is.
  expect(
    popover
      .getByRole('option')
      .elements()
      .map((el) => el.getAttribute('aria-label')),
  ).toEqual([ANY, 'A', 'B flat', 'D'])
  await keyOption('D').click()
  await expect.element(popover).not.toBeInTheDocument()
  const set = control(facetControlLabel('key', 'D'))
  await expect.element(set).toHaveAttribute('data-set')
  await expect.poll(rowTitles).toEqual(['Midnight on the Water', "Soldier's Joy"])
  await expect.poll(async () => (await stored(db)).key).toBe('D')
  await set.click()
  await keyOption(ANY).click()
  await expect.element(control(facetControlLabel('key', 'all'))).not.toHaveAttribute('data-set')
  await expect.poll(() => rowTitles().length).toBe(4)
})

it.each(['pointer', 'touch'] as const)(
  'closes the key chooser on Escape on %s and keeps the key',
  async (density) => {
    const db = openTestDb()
    await seed(db, { key: 'D' })
    await mount(db, density)
    await control(facetControlLabel('key', 'D')).click()
    const chooser = page.getByRole('dialog', { name: KEY })
    await expect.element(keyOption('D')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(chooser).not.toBeInTheDocument()
    await expect.element(control(facetControlLabel('key', 'D'))).toHaveAttribute('data-set')
    expect((await stored(db)).key).toBe('D')
  },
)

const FRAMES = [
  ['phone', { width: 390, height: 844 }, 'touch'],
  ['split', { width: 820, height: 1180 }, 'touch'],
  ['wide', { width: 1280, height: 800 }, 'pointer'],
] as const

it.each(FRAMES)(
  'leads the row with Status, Key, and Filters on %s, and no Type',
  async (_, frame, density) => {
    const db = openTestDb()
    await seed(db)
    await renderApp({ path: '/catalog', db, frame, density, launcher: { open: () => {} } })
    await expect
      .poll(() =>
        filterRow()
          .getByRole('button')
          .elements()
          .map((el) => el.getAttribute('aria-label') ?? el.textContent),
      )
      .toEqual([statusControlLabel('all'), facetControlLabel('key', 'all'), FILTERS])
  },
)

it('narrows by status from the Status capsule, which reads the stored status', async () => {
  const db = openTestDb()
  await seed(db)
  await createTune(db, { title: 'Cluck Old Hen', key: 'A' }, { status: 'learning' })
  await mount(db)
  await control(statusControlLabel('all')).click()
  const learning = page.getByRole('menuitemradio', { name: STATUS_LABELS.learning, exact: true })
  await expect.element(learning).toHaveAccessibleDescription(countTunes(1))
  await learning.click()
  await expect.element(control(statusControlLabel('learning'))).toHaveAttribute('data-set')
  await expect.poll(rowTitles).toEqual(['Cluck Old Hen'])
  await expect.poll(async () => (await stored(db)).status).toBe('learning')
  // Status is no sheet filter: it adds no token and leaves the Filters count alone.
  await expect.element(control(FILTERS)).toBeVisible()
  await control(statusControlLabel('learning')).click()
  await page.getByRole('menuitemradio', { name: CATALOG, exact: true }).click()
  await expect.element(control(statusControlLabel('all'))).not.toHaveAttribute('data-set')
  await expect.poll(() => rowTitles().length).toBe(5)
})

it('narrows by type from the sheet, with a token that removes it', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await control(FILTERS).click()
  const sheet = page.getByRole('dialog', { name: FILTERS })
  await sheet.getByRole('button', { name: new RegExp(FACET_LABELS.tune_type) }).click()
  await page.getByRole('option', { name: 'waltz' }).click()
  await expect.poll(async () => (await stored(db)).tune_type).toBe('waltz')
  await sheet.getByRole('button', { name: DONE }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  const token = control(removeFilterLabel('waltz'))
  await expect.element(token).toBeVisible()
  await expect.element(control(filtersLabel(1))).toBeVisible()
  await expect.poll(rowTitles).toEqual(['Midnight on the Water', 'Ookpik Waltz'])
  await token.click()
  await expect.element(token).not.toBeInTheDocument()
  await expect.element(control(FILTERS)).toBeVisible()
  await expect.poll(() => rowTitles().length).toBe(4)
})

it('adds a token naming the instrument from the sheet, and the token removes the filter', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db)
  await control(FILTERS).click()
  const sheet = page.getByRole('dialog', { name: FILTERS })
  await sheet.getByRole('button', { name: new RegExp(FACET_LABELS['tuning:violin']) }).click()
  await page.getByRole('option', { name: CROSS_A }).click()
  await expect.poll(async () => (await stored(db))['tuning:violin']).toBe(CROSS_A)
  await sheet.getByRole('button', { name: DONE }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  const token = control(removeFilterLabel(withInstrumentLabel('violin', CROSS_A)))
  await expect.element(token).toBeVisible()
  await expect.element(control(filtersLabel(1))).toBeVisible()
  await expect.poll(rowTitles).toEqual(["Bonaparte's Retreat"])
  await token.click()
  await expect.element(token).not.toBeInTheDocument()
  await expect.element(control(FILTERS)).toBeVisible()
  await expect.poll(() => rowTitles().length).toBe(4)
})

it('names the field on a composer token', async () => {
  const db = openTestDb()
  await seed(db, { composer: 'Benny Thomasson' })
  await mount(db)
  await expect
    .element(control(removeFilterLabel(`${FACET_LABELS.composer}: Benny Thomasson`)))
    .toBeVisible()
  await expect.poll(rowTitles).toEqual(['Midnight on the Water'])
})

it('keeps a value the catalog no longer holds as its own choice, never Any', async () => {
  const db = openTestDb()
  await seed(db, { tune_type: 'jig', composer: 'Ed Haley' })
  await mount(db)
  await expect.element(control(removeFilterLabel('jig'))).toBeVisible()
  await control(filtersLabel(2)).click()
  const sheet = page.getByRole('dialog', { name: FILTERS })
  const type = sheet.getByRole('button', { name: new RegExp(FACET_LABELS.tune_type) })
  await expect.element(type).toHaveTextContent('jig')
  await type.click()
  await expect
    .element(page.getByRole('option', { name: 'jig' }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Escape}')
  const composer = sheet.getByRole('button', { name: new RegExp(FACET_LABELS.composer) })
  await expect.element(composer).toHaveTextContent('Ed Haley')
  await composer.click()
  await expect
    .element(page.getByRole('option', { name: 'Ed Haley' }))
    .toHaveAttribute('aria-selected', 'true')
})

it('clears a hidden facet with the next write, and never narrows by it', async () => {
  const db = openTestDb()
  await seed(db, { 'tuning:violin': CROSS_A })
  await setInstruments(db, 'user_1', ['mandolin'])
  await mount(db)
  await expect.poll(() => rowTitles().length).toBe(4)
  await expect.element(control(FILTERS)).toBeVisible()
  await control(facetControlLabel('key', 'all')).click()
  await keyOption('D').click()
  await expect.poll(async () => (await stored(db))['tuning:violin']).toBe('all')
  expect((await stored(db)).key).toBe('D')
})

it('applies each sheet choice at once, resets only its own filters, and closes on Done', async () => {
  const db = openTestDb()
  await seed(db, { key: 'D', composer: 'Benny Thomasson' })
  await mount(db)
  const opener = control(filtersLabel(1))
  await expect.element(opener).toHaveAttribute('aria-expanded', 'false')
  // Held directly, since the row is hidden from role queries while the sheet is up.
  const openerElement = opener.element()
  await opener.click()
  const sheet = page.getByRole('dialog', { name: FILTERS })
  await expect.poll(() => openerElement.getAttribute('aria-expanded')).toBe('true')
  const archived = sheet.getByRole('switch', { name: SHOW_ARCHIVED })
  await expect.element(archived).not.toBeChecked()
  await sheet.getByText(SHOW_ARCHIVED).click()
  await expect.poll(async () => (await stored(db)).archived).toBe(true)
  await sheet.getByRole('button', { name: new RegExp(MISSING_LABEL) }).click()
  await page.getByRole('option', { name: MISSING_LABELS.tune_type }).click()
  await expect.poll(async () => (await stored(db)).missing).toBe('tune_type')
  await sheet.getByRole('button', { name: RESET }).click()
  await expect.element(archived).not.toBeChecked()
  await expect
    .element(sheet.getByRole('button', { name: new RegExp(FACET_LABELS.composer) }))
    .toHaveTextContent(ANY)
  await expect.element(sheet.getByRole('button', { name: RESET })).toBeDisabled()
  await sheet.getByRole('button', { name: DONE }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  const after = await stored(db)
  expect(after).toMatchObject({ key: 'D', composer: 'all', archived: false, missing: 'all' })
  await expect.element(control(FILTERS)).toBeVisible()
  await expect.element(control(removeFilterLabel(ARCHIVED_SHOWN))).not.toBeInTheDocument()
})

it('leaves out the filter row while there is nothing to filter', async () => {
  const db = openTestDb()
  await mount(db)
  await expect.element(page.getByRole('heading', { name: NO_TUNES_TITLE })).toBeVisible()
  await expect.element(filterRow()).not.toBeInTheDocument()
})

it('keeps a set filter in an empty catalog until it is removed, then moves focus to the title', async () => {
  const db = openTestDb()
  // Saved by an earlier session.
  await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, archived: true })
  await mount(db)
  await expect.element(page.getByRole('heading', { name: NO_TUNES_TITLE })).toBeVisible()
  const token = control(removeFilterLabel(ARCHIVED_SHOWN))
  await expect.element(token).toBeVisible()
  await expect.element(control(filtersLabel(1))).toBeEnabled()
  ;(token.element() as HTMLElement).focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(filterRow()).not.toBeInTheDocument()
  await expect.element(page.getByRole('heading', { level: 1 })).toHaveFocus()
  await expect.poll(async () => (await stored(db)).archived).toBe(false)
})

it('moves focus to the title when Reset in the sheet leaves an empty catalog nothing to filter', async () => {
  const db = openTestDb()
  await setMeta(db, META_CATALOG_FILTERS, { ...DEFAULT_FILTERS, archived: true })
  await mount(db)
  await control(filtersLabel(1)).click()
  const sheet = page.getByRole('dialog', { name: FILTERS })
  await sheet.getByRole('button', { name: RESET }).click()
  await expect.poll(async () => (await stored(db)).archived).toBe(false)
  await sheet.getByRole('button', { name: DONE }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.element(filterRow()).not.toBeInTheDocument()
  await expect.element(page.getByRole('heading', { level: 1 })).toHaveFocus()
})

it('opens the key grid in a sheet on touch, and choosing a key closes it', async () => {
  const db = openTestDb()
  await seed(db)
  await mount(db, 'touch')
  await control(facetControlLabel('key', 'all')).click()
  const sheet = page.getByRole('dialog', { name: KEY })
  await expect.element(sheet.getByRole('listbox', { name: KEY })).toBeVisible()
  await sheet.getByRole('option', { name: 'B flat' }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.poll(rowTitles).toEqual(['Ookpik Waltz'])
})

const MANY = {
  composer: 'Benny Thomasson',
  'tuning:violin': CROSS_A,
  archived: true,
  unheard: true,
} satisfies Partial<CatalogFilters>

function RowHost({ ready, filters }: { ready: boolean; filters: Partial<CatalogFilters> }) {
  const facets = Object.fromEntries(FACETS.map((facet) => [facet, []])) as unknown as FacetValues
  facets.key = ['A', 'D']
  facets.tune_type = ['reel', 'waltz']
  facets.composer = ['Benny Thomasson']
  facets['tuning:violin'] = [CROSS_A]
  const visible: Facet[] = ['key', 'tune_type', 'tuning:violin', 'composer']
  const effective = { ...DEFAULT_FILTERS, ...filters }
  return (
    // Reduced motion makes the row's reveal instant, so a scroll it makes shows at once.
    <MotionConfig reducedMotion="always">
      <CatalogFilterRow
        ready={ready}
        filters={effective}
        facets={facets}
        visible={visible}
        missing={[]}
        counts={{ visible: 4, total: 4, archived: 0, all: 4 }}
        sheet={sheetFilters(effective, visible, ROW_FACETS)}
        statusCounts={undefined}
        title={{ current: null }}
        onChange={() => {}}
      />
    </MotionConfig>
  )
}

it('keeps the touch row at its start when saved filters load, and reveals one set later', async () => {
  const { rerender } = renderWithProviders(<RowHost ready={false} filters={MANY} />, {
    density: 'touch',
  })
  await expect.element(filterRow()).not.toBeInTheDocument()
  rerender(<RowHost ready filters={MANY} />)
  const row = filterRow()
  await expect.element(control(removeFilterLabel(ARCHIVED_SHOWN))).toBeInTheDocument()
  expect(row.element().scrollWidth).toBeGreaterThan(row.element().clientWidth)
  expect(row.element().scrollLeft).toBe(0)
  rerender(<RowHost ready filters={{ ...MANY, missing: 'genre' }} />)
  const added = control(removeFilterLabel(`${MISSING_LABEL} ${MISSING_LABELS.genre}`))
  await expect.element(added).toBeInTheDocument()
  expect(row.element().scrollLeft).toBeGreaterThan(0)
  expect(
    added.element().getBoundingClientRect().right - row.element().getBoundingClientRect().right,
  ).toBeLessThanOrEqual(0)
})

it('wraps the row on pointer', async () => {
  const db = openTestDb()
  await seed(db, MANY)
  await mount(db)
  const row = filterRow()
  await expect.element(control(removeFilterLabel(ARCHIVED_SHOWN))).toBeVisible()
  expect(getComputedStyle(row.element()).flexWrap).toBe('wrap')
  expect(row.element().scrollWidth).toBeLessThanOrEqual(row.element().clientWidth)
})
