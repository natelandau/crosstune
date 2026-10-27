import { MemoryRouter } from 'react-router'
import { page, userEvent } from 'vitest/browser'
import { afterAll, expect, it, vi } from 'vitest'
import { addToList, createList } from '../../commands/lists'
import * as tunes from '../../commands/tunes'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import type { Instrument } from '../../api/vocabulary'
import { computedColor } from '../../test/color'
import { addedDay } from '../../text/format'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { DONE } from '../../ui/confirmCopy'
import { KEY } from '../../ui/keyName'
import { tuningLabel } from '../../domain/instruments'
import { DETAIL_LABELS } from './detailFields'
import { STATUS_HEADER } from './tuneFormCopy'
import {
  ABOUT_GROUP,
  ADDED_ON,
  DETAILS_GROUP,
  attributeRowName,
  ATTRIBUTES_LABEL,
  LEARNED_GROUP,
  LISTS_GROUP,
  MORE_DETAILS,
} from './attributeCopy'
import { attributesLayout, MIN_CONTENT_WIDTH, COLUMN_WIDTH } from './attributesLayout'
import { TuneAttributes } from './TuneAttributes'
import { useTune } from './useTune'
import type { TuneListMembership } from './useTuneScreen'

// A passthrough a test can refuse once; every other test runs the real command.
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return { ...actual, updateTuneEntry: vi.fn(actual.updateTuneEntry) }
})

afterAll(async () => {
  await page.viewport(390, 844)
})

const INSTRUMENTS: ReadonlySet<Instrument> = new Set()

function Page({
  tuneId,
  layout,
  instruments = INSTRUMENTS,
  inLists = [],
  onAddToList = () => {},
}: {
  tuneId: string
  layout: 'column' | 'card'
  instruments?: ReadonlySet<Instrument>
  inLists?: TuneListMembership[]
  onAddToList?: () => void
}) {
  const view = useTune(tuneId)
  if (!view) return null
  return (
    <MemoryRouter>
      {/* Keyed by layout: the page puts each layout under its own parent, which remounts it. */}
      <TuneAttributes
        key={layout}
        view={view}
        instruments={instruments}
        inLists={inLists}
        createdAt={view.tune.created_at}
        layout={layout}
        onAddToList={onAddToList}
      />
    </MemoryRouter>
  )
}

async function setup(
  layout: 'column' | 'card',
  props: Partial<Parameters<typeof Page>[0]> = {},
  tune: Parameters<typeof createTune>[1] = { title: 'Reel' },
  frame: 'wide' | 'phone' = 'wide',
) {
  if (frame === 'phone') await page.viewport(390, 844)
  else await page.viewport(1280, 800)
  const db = openTestDb()
  const { tuneId } = await createTune(db, tune, { status: 'learning' })
  const Data = dataProviders({ db })
  const tree = (shape: 'column' | 'card') => (
    <Data>
      <Page tuneId={tuneId} layout={shape} {...props} />
    </Data>
  )
  const { rerender } = renderWithProviders(tree(layout), {
    density: frame === 'phone' ? 'touch' : 'pointer',
  })
  return { db, tuneId, relayout: (shape: 'column' | 'card') => rerender(tree(shape)) }
}

const row = (name: string) => page.getByRole('button', { name })
const dismiss = () =>
  userEvent.click(page.elementLocator(document.body), { position: { x: 1200, y: 700 } })

it('chooses the attributes column only with room beside a readable content column', () => {
  expect(attributesLayout(COLUMN_WIDTH + MIN_CONTENT_WIDTH - 1)).toBe('card')
  expect(attributesLayout(COLUMN_WIDTH + MIN_CONTENT_WIDTH)).toBe('column')
  expect(attributesLayout(655)).toBe('card')
  expect(attributesLayout(656)).toBe('column')
})

it('the attributes column lists every attribute and marks unset ones', async () => {
  await setup('column')
  await expect.element(page.getByRole('complementary', { name: ATTRIBUTES_LABEL })).toBeVisible()
  await expect.element(page.getByRole('button', { name: attributeRowName(KEY) })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: attributeRowName(DETAIL_LABELS.genre) }))
    .toBeVisible()
})

it('a row opens its editor', async () => {
  await setup('column')
  await page.getByRole('button', { name: attributeRowName(KEY) }).click()
  await expect.element(page.getByRole('dialog', { name: KEY })).toBeVisible()
})

it.each(['column', 'card'] as const)('the %s says why a write was refused', async (layout) => {
  await setup(layout)
  vi.mocked(tunes.updateTuneEntry).mockRejectedValueOnce(new Error('Could not save'))
  await page.getByRole('button', { name: attributeRowName(STATUS_HEADER, 'Learning') }).click()
  await page.getByRole('radio', { name: STATUS_LABELS.known }).click()
  await expect
    .element(
      page
        .getByRole('region', { name: ATTRIBUTES_LABEL })
        .or(page.getByRole('complementary', { name: ATTRIBUTES_LABEL }))
        .getByRole('alert'),
    )
    .toHaveTextContent('Could not save')
})

it('card shows the main attributes, then More details reveals the rest', async () => {
  await setup(
    'card',
    { instruments: new Set(['violin']) },
    { title: 'Reel', key: 'D', tune_type: 'Reel', part_structure: 'AABB' },
  )
  const more = page.getByRole('button', { name: MORE_DETAILS })
  await expect.element(more).toHaveAttribute('aria-expanded', 'false')
  for (const name of [
    attributeRowName(STATUS_HEADER, 'Learning'),
    attributeRowName(KEY, 'D'),
    attributeRowName(tuningLabel('violin')),
    attributeRowName(DETAIL_LABELS.tune_type, 'Reel · AABB'),
  ]) {
    await expect.element(page.getByRole('button', { name })).toBeVisible()
  }
  const genre = page.getByRole('button', {
    name: attributeRowName(DETAIL_LABELS.genre),
    includeHidden: true,
  })
  await expect.element(genre).not.toBeInTheDocument()
  await expect.element(page.getByRole('heading', { name: LEARNED_GROUP })).not.toBeInTheDocument()
  await more.click()
  await expect.element(more).toHaveAttribute('aria-expanded', 'true')
  await expect.element(genre).toBeVisible()
  await expect.element(page.getByRole('heading', { name: LEARNED_GROUP })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: attributeRowName(DETAIL_LABELS.learned_from) }))
    .toBeVisible()
})

const bottomRounded = (name: string) =>
  parseFloat(getComputedStyle(row(name).element()).borderBottomLeftRadius) > 0

it('the attributes column sits on the page, with rounded rows and labels in secondary text', async () => {
  await setup('column')
  const column = page.getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(column).toBeVisible()
  await expect
    .poll(() => getComputedStyle(column.element()).backgroundColor)
    .toBe('rgba(0, 0, 0, 0)')
  const status = row(`Status, ${STATUS_LABELS.learning}`)
  await expect
    .poll(() => parseFloat(getComputedStyle(status.element()).borderTopLeftRadius))
    .toBeGreaterThan(0)
  const [label, value] = [...status.element().children] as HTMLElement[]
  await expect
    .poll(() => getComputedStyle(label!).color)
    .toBe(computedColor('var(--text-secondary)'))
  await expect
    .poll(() => getComputedStyle(value!).color)
    .toBe(computedColor('var(--color-text-primary)'))
})

it('the attributes column heads its groups in order and ends with the day the tune joined the catalog', async () => {
  const { db, tuneId } = await setup('column')
  const column = page.getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect.element(column).toBeVisible()
  const headers = () =>
    column
      .getByRole('heading')
      .elements()
      .map((h) => h.textContent)
  await expect.poll(headers).toEqual([DETAILS_GROUP, ABOUT_GROUP, LEARNED_GROUP, LISTS_GROUP])
  const added = ADDED_ON(addedDay((await db.tunes.get(tuneId))!.created_at))
  expect(column.element().lastElementChild?.textContent).toBe(added)
  await expect.element(column.getByRole('button', { name: ADD_TO_LIST })).toBeVisible()
})

it('an attributes column taller than the window scrolls on its own to its last line', async () => {
  const { db, tuneId } = await setup('column')
  await page.viewport(1280, 400)
  const column = page.getByRole('complementary', { name: ATTRIBUTES_LABEL })
  await expect
    .poll(() => column.element().scrollHeight - column.element().clientHeight)
    .toBeGreaterThan(0)
  const added = page.getByText(ADDED_ON(addedDay((await db.tunes.get(tuneId))!.created_at)))
  await expect
    .poll(() => added.element().getBoundingClientRect().top)
    .toBeGreaterThan(window.innerHeight)
  added.element().scrollIntoView({ block: 'end' })
  await expect.poll(() => column.element().scrollTop).toBeGreaterThan(0)
  await expect
    .poll(() => added.element().getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(window.innerHeight)
})

it('card leaves the lists and the day added to the page', async () => {
  const { db, tuneId } = await setup('card')
  const added = ADDED_ON(addedDay((await db.tunes.get(tuneId))!.created_at))
  await row(MORE_DETAILS).click()
  await expect.element(row(attributeRowName(DETAIL_LABELS.alternate_titles))).toBeVisible()
  expect(page.getByRole('button', { name: ADD_TO_LIST }).query()).toBeNull()
  expect(page.getByText(added).query()).toBeNull()
})

it("card rounds its last row's corners, folded or not", async () => {
  await setup('card')
  await expect.poll(() => bottomRounded(MORE_DETAILS)).toBe(true)
  await row(MORE_DETAILS).click()
  await expect
    .poll(() => bottomRounded(attributeRowName(DETAIL_LABELS.alternate_titles)))
    .toBe(true)
  expect(bottomRounded(MORE_DETAILS)).toBe(false)
})

it('card edits parts from More details', async () => {
  await setup('card', {}, { title: 'Reel', tune_type: 'Reel', part_structure: 'AABB' })
  await page.getByRole('button', { name: MORE_DETAILS }).click()
  await page.getByRole('button', { name: 'Parts, AABB' }).click()
  await expect.element(page.getByRole('dialog', { name: 'Parts' })).toBeVisible()
})

it('lists link to the list and add to a list', async () => {
  const onAddToList = vi.fn()
  const db = openTestDb()
  const { tuneId, userTuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
  const listId = await createList(db, 'Fall practice')
  await addToList(db, listId, userTuneId)
  await page.viewport(1280, 800)
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <Page
        tuneId={tuneId}
        layout="column"
        inLists={[{ id: listId, name: 'Fall practice', itemId: 'i' }]}
        onAddToList={onAddToList}
      />
    </Data>,
    { density: 'pointer' },
  )
  await expect
    .element(page.getByRole('link', { name: 'Fall practice' }))
    .toHaveAttribute('href', `/lists/${listId}`)
  await page.getByRole('button', { name: ADD_TO_LIST }).click()
  expect(onAddToList).toHaveBeenCalledOnce()
})

it('keeps typed text when a relayout remounts the open editor', async () => {
  const { db, tuneId, relayout } = await setup('column')
  await row(attributeRowName(DETAIL_LABELS.composer)).click()
  await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Kenny Baker')
  relayout('card')
  await expect
    .element(page.getByRole('dialog', { name: DETAIL_LABELS.composer }))
    .not.toBeInTheDocument()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.composer).toBe('Kenny Baker')
})

it('returns focus to the row after a pick', async () => {
  await setup('column')
  await row(attributeRowName(STATUS_HEADER, 'Learning')).click()
  await page.getByRole('radio', { name: STATUS_LABELS.known }).click()
  await expect.element(row(attributeRowName(STATUS_HEADER, 'Known'))).toHaveFocus()
})

it('returns focus to the row after a pick from a nested list', async () => {
  await setup('column')
  await row(attributeRowName(DETAIL_LABELS.time_signature)).click()
  await page
    .getByRole('dialog', { name: DETAIL_LABELS.time_signature })
    .getByRole('button', { name: /Time signature$/ })
    .click()
  await page.getByRole('option', { name: '6/8' }).click()
  await expect.element(row(attributeRowName(DETAIL_LABELS.time_signature, '6/8'))).toHaveFocus()
})

it('returns focus to the row after Escape', async () => {
  await setup('column')
  await row(attributeRowName(DETAIL_LABELS.composer)).click()
  await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Kenny Baker')
  await userEvent.keyboard('{Escape}')
  await expect.element(row(attributeRowName(DETAIL_LABELS.composer))).toHaveFocus()
})

it('returns focus to the row after a click outside', async () => {
  await setup('column')
  await row(attributeRowName(DETAIL_LABELS.composer)).click()
  await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Kenny Baker')
  await dismiss()
  await expect.element(row(attributeRowName(DETAIL_LABELS.composer, 'Kenny Baker'))).toHaveFocus()
})

it('returns focus to the card row after Done', async () => {
  await setup('card', {}, { title: 'Reel' }, 'phone')
  await row(attributeRowName(STATUS_HEADER, 'Learning')).click()
  await page.getByRole('button', { name: DONE }).click()
  await expect.element(row(attributeRowName(STATUS_HEADER, 'Learning'))).toHaveFocus()
})

it('returns focus to the card row after a pick in the sheet', async () => {
  await setup('card', {}, { title: 'Reel' }, 'phone')
  await row(attributeRowName(STATUS_HEADER, 'Learning')).click()
  await page.getByRole('radio', { name: STATUS_LABELS.known }).click()
  await expect.element(row(attributeRowName(STATUS_HEADER, 'Known'))).toHaveFocus()
})

it('opens one editor at a time', async () => {
  const { db, tuneId } = await setup('column')
  await row(attributeRowName(DETAIL_LABELS.composer)).click()
  await page.getByRole('combobox', { name: DETAIL_LABELS.composer }).fill('Kenny Baker')
  // A press outside the open editor only closes it, so the next row takes a press of its own.
  await dismiss()
  await expect
    .element(page.getByRole('dialog', { name: DETAIL_LABELS.composer }))
    .not.toBeInTheDocument()
  await expect.element(row(attributeRowName(DETAIL_LABELS.composer, 'Kenny Baker'))).toBeVisible()
  await row(attributeRowName(DETAIL_LABELS.genre)).click()
  await expect.element(page.getByRole('dialog', { name: DETAIL_LABELS.genre })).toBeVisible()
  expect(page.getByRole('dialog').elements()).toHaveLength(1)
  expect((await db.tunes.get(tuneId))?.composer).toBe('Kenny Baker')
})
