import { page, userEvent } from 'vitest/browser'
import { afterEach, expect, it, vi } from 'vitest'
import * as tunes from '../../commands/tunes'
import { createTune, setArchived } from '../../commands/tunes'
import { computedColor } from '../../test/color'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { recordingAnalytics } from '../../usage/testing'
import { ARCHIVED } from './archiveLabels'
import { TuneBand } from './TuneBand'
import { TUNE_TITLE_LABEL } from './tuneFormCopy'
import { EDIT_TITLE, KEY_TILE_EMPTY } from './tuneScreenCopy'
import { KEY, spokenKey } from '../../ui/keyName'
import { useTune } from './useTune'

// A passthrough a test can refuse once; every other test runs the real command.
vi.mock('../../commands/tunes', async (original) => {
  const actual = await original<typeof tunes>()
  return { ...actual, updateTuneEntry: vi.fn(actual.updateTuneEntry) }
})

afterEach(async () => {
  await page.viewport(390, 844)
})

function Band({ tuneId }: { tuneId: string }) {
  const view = useTune(tuneId)
  if (!view) return null
  return (
    <TuneBand
      tuneId={tuneId}
      view={view}
      facts={{
        title: view.tune.title,
        alternateTitles: view.tune.alternate_titles,
        key: view.tune.key || null,
        modes: view.tune.modes,
        archived: view.userTune.archived_at !== null,
        hasLyrics: false,
      }}
      title={undefined}
      active
      gutter="px-4"
      actions={null}
    />
  )
}

async function setup(
  tune: Parameters<typeof createTune>[1],
  density: 'pointer' | 'touch' = 'pointer',
) {
  const db = openTestDb()
  const analytics = recordingAnalytics()
  const { tuneId } = await createTune(db, tune, { status: 'learning' })
  const Data = dataProviders({ db, analytics })
  renderWithProviders(
    <Data>
      <Band tuneId={tuneId} />
    </Data>,
    { density },
  )
  const title = async () => (await db.tunes.get(tuneId))?.title
  return { db, tuneId, title, analytics }
}

const rename = (title: string) => page.getByRole('button', { name: `${EDIT_TITLE} ${title}` })
const heading = () => page.getByRole('heading', { level: 1 })
const field = () => page.getByRole('textbox', { name: TUNE_TITLE_LABEL })

it("only the key tile takes the key's color", async () => {
  await setup({ title: 'Sally Goodin', key: 'A', modes: ['major'] })
  const tile = page.getByRole('button', { name: 'Key, A major' })
  await expect.element(tile).toBeVisible()
  const band = tile.element().closest('header')!
  await expect.poll(() => getComputedStyle(band).backgroundImage).toBe('none')
  await expect.poll(() => getComputedStyle(band).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  await expect
    .poll(() => getComputedStyle(tile.element()).backgroundColor)
    .toBe(computedColor('var(--key-9-bg)'))
})

it('a tune with no key offers Add key', async () => {
  await setup({ title: 'Cluck Old Hen' })
  const tile = page.getByRole('button', { name: KEY_TILE_EMPTY })
  await expect.element(tile).toBeVisible()
  await expect.poll(() => getComputedStyle(tile.element()).borderStyle).toBe('dashed')
  await tile.click()
  await expect.element(page.getByRole('dialog', { name: 'Key' })).toBeVisible()
})

it('renaming saves on Enter', async () => {
  const { title, analytics } = await setup({ title: 'Sally Goodin' })
  await heading().click()
  await expect.element(field()).toHaveValue('Sally Goodin')
  await field().fill('Sally Gooden')
  await userEvent.keyboard('{Enter}')
  await expect.poll(title).toBe('Sally Gooden')
  await expect.element(rename('Sally Gooden')).toHaveFocus()
  await expect
    .poll(() => analytics.sends().filter((send) => send.name === 'tune_edited'))
    .toEqual([
      { name: 'tune_edited', props: { fields_changed: ['title'], tune_id: expect.any(String) } },
    ])
})

it('an emptied title restores on blur', async () => {
  const { title } = await setup({ title: 'Sally Goodin' })
  await heading().click()
  await field().fill('   ')
  await userEvent.click(document.body)
  await expect.element(field()).not.toBeInTheDocument()
  await expect.element(page.getByRole('heading', { level: 1 })).toHaveTextContent('Sally Goodin')
  expect(await title()).toBe('Sally Goodin')
})

it('Escape restores the title', async () => {
  const { title } = await setup({ title: 'Sally Goodin' })
  await heading().click()
  await field().fill('Sally Gooden')
  await userEvent.keyboard('{Escape}')
  await expect.element(field()).not.toBeInTheDocument()
  await expect.element(rename('Sally Goodin')).toHaveFocus()
  expect(await title()).toBe('Sally Goodin')
})

it('leaving the field saves what was typed', async () => {
  const { title } = await setup({ title: 'Sally Goodin' })
  await heading().click()
  await field().fill('Sally Gooden')
  await userEvent.click(document.body)
  await expect.poll(title).toBe('Sally Gooden')
})

it('a page that goes with the field open saves what was typed', async () => {
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Sally Goodin' }, { status: 'learning' })
  const Data = dataProviders({ db })
  const { rerender } = renderWithProviders(
    <Data>
      <Band tuneId={tuneId} />
    </Data>,
  )
  await heading().click()
  await field().fill('Sally Gooden')
  // Back by keyboard unmounts the page with focus still in the field, and no blur.
  rerender(<Data>{null}</Data>)
  await expect.poll(async () => (await db.tunes.get(tuneId))?.title).toBe('Sally Gooden')
})

it('selecting the title reads it rather than renaming', async () => {
  await setup({ title: 'Sally Goodin' })
  await expect.element(heading()).toHaveTextContent('Sally Goodin')
  const text = heading().element().firstChild!
  window.getSelection()!.setBaseAndExtent(text, 0, text, 5)
  ;(heading().element() as HTMLElement).click()
  // The field would hide the heading under it.
  await expect.element(heading()).toBeVisible()
  expect(field().elements()).toHaveLength(0)
  expect(window.getSelection()!.toString()).toBe('Sally')
  window.getSelection()!.removeAllRanges()
})

it('renames from the keyboard', async () => {
  const { title } = await setup({ title: 'Sally Goodin' })
  await expect.element(rename('Sally Goodin')).toBeInTheDocument()
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(rename('Sally Goodin')).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(field()).toHaveFocus()
  await userEvent.keyboard('Sally Gooden{Enter}')
  await expect.poll(title).toBe('Sally Gooden')
})

it('says an archived tune is archived', async () => {
  const { db, tuneId } = await setup({ title: 'Sally Goodin' })
  await expect.element(heading()).toBeVisible()
  expect(page.getByText(ARCHIVED, { exact: true }).elements()).toHaveLength(0)
  const userTune = (await db.user_tunes.where('tune_id').equals(tuneId).first())!
  await setArchived(db, userTune.id, true)
  await expect.element(page.getByText(ARCHIVED, { exact: true })).toBeVisible()
})

it('says why a key from the tile was refused', async () => {
  await setup({ title: 'Sally Goodin' })
  vi.mocked(tunes.updateTuneEntry).mockRejectedValueOnce(new Error('Could not save'))
  await page.getByRole('button', { name: KEY_TILE_EMPTY }).click()
  await page.getByRole('option', { name: 'D' }).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('Could not save')
})

it('returns focus to the key tile after Escape', async () => {
  await page.viewport(1280, 800)
  await setup({ title: 'Reel' })
  await page.getByRole('button', { name: KEY_TILE_EMPTY }).click()
  await expect.element(page.getByRole('dialog', { name: KEY })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('button', { name: KEY_TILE_EMPTY })).toHaveFocus()
})

it('returns focus to the key tile after a pick and a click outside', async () => {
  await page.viewport(1280, 800)
  await setup({ title: 'Reel' })
  await page.getByRole('button', { name: KEY_TILE_EMPTY }).click()
  await page.getByRole('option', { name: spokenKey('D') }).click()
  // Settled first, since the body's locator is found by the text it holds.
  await expect.element(page.getByRole('button', { name: 'Key, D' })).toBeInTheDocument()
  await userEvent.click(page.elementLocator(document.body), { position: { x: 1000, y: 600 } })
  await expect.element(page.getByRole('dialog', { name: KEY })).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'Key, D' })).toHaveFocus()
})

it('leaves a mode out of the tile when the facts leave it out', async () => {
  await setup({ title: 'Reel', key: 'A', modes: ['other'] })
  const tile = page.getByRole('button', { name: 'Key, A', exact: true })
  await expect.element(tile).toBeVisible()
  await expect.element(tile).not.toHaveTextContent('other')
})

it.each([
  ['touch', '1'],
  ['pointer', '0'],
] as const)('shows Rename at rest on %s', async (density, opacity) => {
  await setup({ title: 'Reel' }, density)
  // The browser pointer is shared between tests, so one left over an earlier test's title would
  // reveal the button here.
  await userEvent.unhover(page.elementLocator(document.body))
  await expect.poll(() => getComputedStyle(rename('Reel').element()).opacity).toBe(opacity)
})
