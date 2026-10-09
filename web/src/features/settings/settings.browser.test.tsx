import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { setInstruments } from '../../commands/settings'
import { AUDIO_QUALITY_NAMES, INSTRUMENT_LABELS, STATUS_LABELS } from '../../constants'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { RECORDING } from '../../text/format'
import { STORAGE_USED } from '../recordings/recordingsCopy'
import {
  APPEARANCE_KEY,
  APPEARANCE_LABELS,
  setAppearance,
  setTextSize,
  TEXT_SIZE_KEY,
  TEXT_SIZE_LABELS,
} from '../../theme/appearance'
import { CONFIRM_LABEL, DELETE_ACCOUNT, DELETE_CONFIRMATION_TEXT } from './deleteAccountCopy'
import { NEW_TUNE_GENRE_LABEL, NEW_TUNE_STATUS_LABEL } from './newTunes'
import { MUSIC_SERVICES, SEARCHABLE_PROVIDERS, servicesSummary } from './searchProviders'
import {
  ACCOUNT,
  APPEARANCE,
  INSTRUMENTS,
  NEW_TUNES,
  SYNC_AND_STORAGE,
  SYNC_NOW,
  TEXT_SIZE_LABEL,
  THEME_LABEL,
  SETTINGS_CATEGORIES,
} from './settingsCopy'
import { formatRecorded } from '../stats/formatRecorded'
import { OFFLINE } from '../../sync/labels'
import { openTestDb } from '../../test/db'
import { NOT_SET } from '../../ui/fieldCopy'
import { destination } from '../../app/destinations'
import { STUB_USER_NAME } from '../../fixture/clerkStub'
import { renderApp } from '../../test/renderApp'
import { NO_SETTING_SELECTED } from './SettingsLayout'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const SETTINGS = destination('settings')

async function mount(
  path: string,
  frame = PHONE,
  {
    before,
    sync,
  }: {
    before?: (db: CrosstuneDb) => Promise<unknown>
    sync?: Parameters<typeof renderApp>[0]['sync']
  } = {},
) {
  const db = openTestDb()
  await before?.(db)
  const app = await renderApp({ path, db, frame, sync })
  return { ...app, db }
}

const at = (router: { state: { location: { pathname: string } } }) => () =>
  router.state.location.pathname
const categories = () => page.getByRole('grid', { name: SETTINGS_CATEGORIES })
const rowTitles = () =>
  categories()
    .getByRole('row')
    .elements()
    .map((row) => row.querySelector('[data-row-title]')?.textContent)
const account = () => page.getByRole('link', { name: new RegExp(STUB_USER_NAME) })
// The tab bar has a Settings link too, so Back is the one on the page.
const back = () => page.getByRole('main').getByRole('link', { name: SETTINGS.label })

it('lists the categories in order, each with its summary, on the phone', async () => {
  await mount('/settings', PHONE, { before: (db) => setInstruments(db, 'user_1', ['violin']) })
  await expect.element(page.getByRole('heading', { level: 1, name: SETTINGS.label })).toBeVisible()
  await expect
    .poll(rowTitles)
    .toEqual([INSTRUMENTS, NEW_TUNES, MUSIC_SERVICES, RECORDING, APPEARANCE, SYNC_AND_STORAGE])
  const row = (name: string) => categories().getByRole('row', { name: new RegExp(`^${name}`) })
  await expect.element(row(INSTRUMENTS)).toHaveTextContent(INSTRUMENT_LABELS.violin)
  await expect
    .element(row(MUSIC_SERVICES))
    .toHaveTextContent(servicesSummary(SEARCHABLE_PROVIDERS.length))
  await expect.element(row(RECORDING)).toHaveTextContent(AUDIO_QUALITY_NAMES.standard)
  await expect.element(row(APPEARANCE)).toHaveTextContent(APPEARANCE_LABELS.system)
  await expect.element(account()).toBeVisible()
  // The phone has no detail column, so nothing stands in for a page.
  await expect.element(page.getByText(NO_SETTING_SELECTED)).not.toBeInTheDocument()
})

it('pushes a category on the phone, and Back returns to the categories', async () => {
  const { router } = await mount('/settings')
  await categories()
    .getByRole('row', { name: new RegExp(`^${INSTRUMENTS}`) })
    .click()
  await expect.poll(at(router)).toBe('/settings/instruments')
  await expect.element(page.getByRole('heading', { level: 1, name: INSTRUMENTS })).toBeVisible()
  await expect.element(categories()).not.toBeInTheDocument()
  await back().click()
  await expect.poll(at(router)).toBe('/settings')
  await expect.poll(() => router.state.historyAction).toBe('POP')
  await expect.element(categories()).toBeVisible()
})

it('opens a page by its address on wide beside the categories', async () => {
  await mount('/settings/sync', WIDE)
  await expect
    .element(page.getByRole('region', { name: SETTINGS.label }).getByRole('grid'))
    .toBeVisible()
  const detail = page.getByRole('main', { name: SYNC_AND_STORAGE })
  await expect
    .element(detail.getByRole('heading', { level: 1, name: SYNC_AND_STORAGE }))
    .toBeVisible()
  await expect.element(detail.getByRole('button', { name: SYNC_NOW })).toBeVisible()
  await expect
    .element(categories().getByRole('row', { name: new RegExp(`^${SYNC_AND_STORAGE}`) }))
    .toHaveAttribute('aria-selected', 'true')
  // Wide shows the parent beside the page, so the page has no Back.
  await expect.element(back()).not.toBeInTheDocument()
})

it('replaces the open page in the detail as ArrowDown walks the categories on wide', async () => {
  const { router } = await mount('/settings/new-tunes', WIDE)
  const newTunes = categories().getByRole('row', { name: new RegExp(`^${NEW_TUNES}`) })
  await expect.element(newTunes).toHaveAttribute('aria-selected', 'true')
  ;(newTunes.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(at(router)).toBe('/settings/music-services')
  expect(router.state.historyAction).toBe('REPLACE')
  await expect
    .element(
      page
        .getByRole('main', { name: MUSIC_SERVICES })
        .getByRole('heading', { level: 1, name: MUSIC_SERVICES }),
    )
    .toBeVisible()
  await expect
    .element(categories().getByRole('row', { name: new RegExp(`^${MUSIC_SERVICES}`) }))
    .toHaveAttribute('aria-selected', 'true')
})

it('opens a page by its address on the phone alone, with Back to Settings', async () => {
  const { router } = await mount('/settings/sync')
  await expect
    .element(page.getByRole('main').getByRole('heading', { level: 1, name: SYNC_AND_STORAGE }))
    .toBeVisible()
  await expect.element(categories()).not.toBeInTheDocument()
  await back().click()
  await expect.poll(at(router)).toBe('/settings')
  await expect.element(categories()).toBeVisible()
})

it('holds a page to the readable width on a large window', async () => {
  await mount(
    '/settings/sync',
    { width: 1920, height: 1080 },
    {
      before: (db) => setStorage(db, { used_bytes: 1, quota_bytes: 2, max_file_bytes: 1 }),
    },
  )
  const bar = page
    .getByRole('main', { name: SYNC_AND_STORAGE })
    .getByRole('progressbar', { name: STORAGE_USED })
  await expect.element(bar).toBeVisible()
  await expect.poll(() => bar.element().getBoundingClientRect().width).toBeLessThanOrEqual(680)
})

it('shows a category summary whole on wide while the row has room for it', async () => {
  await mount('/settings', WIDE, {
    before: (db) => setInstruments(db, 'user_1', ['violin', 'five_string_banjo']),
  })
  const summary = categories().getByText(
    `${INSTRUMENT_LABELS.violin}, ${INSTRUMENT_LABELS.five_string_banjo}`,
  )
  await expect.element(summary).toBeVisible()
  await expect
    .poll(() => summary.element().scrollWidth - summary.element().clientWidth)
    .toBeLessThanOrEqual(0)
})

it('breaks the catalog line only between its parts', async () => {
  await mount('/settings')
  const recorded = page.getByText(formatRecorded(0), { exact: true })
  await expect.element(recorded).toBeVisible()
  expect(getComputedStyle(recorded.element()).whiteSpace).toBe('nowrap')
})

it('says no setting is selected on wide while no page is open', async () => {
  await mount('/settings', WIDE)
  await expect.element(page.getByRole('heading', { name: NO_SETTING_SELECTED })).toBeVisible()
})

it('updates the Instruments summary on the root as an instrument toggles', async () => {
  const { db } = await mount('/settings/instruments', WIDE)
  const row = categories().getByRole('row', { name: new RegExp(`^${INSTRUMENTS}`) })
  // The loaded summary, so the toggle below is what changes it.
  await expect.element(row).toHaveTextContent(NOT_SET)
  const detail = page.getByRole('main', { name: INSTRUMENTS })
  // The switch's input is visually hidden, so the press lands on its label.
  await detail.getByText(INSTRUMENT_LABELS.violin, { exact: true }).click()
  await expect.element(detail.getByRole('switch', { name: INSTRUMENT_LABELS.violin })).toBeChecked()
  await expect.element(row).toHaveTextContent(INSTRUMENT_LABELS.violin)
  await expect
    .poll(async () => (await db.user_settings.toArray())[0]?.instruments)
    .toEqual(['violin'])
})

it('saves the status and genre a new tune starts with, and sums up the genre', async () => {
  const { db } = await mount('/settings/new-tunes', WIDE)
  const row = categories().getByRole('row', { name: new RegExp(`^${NEW_TUNES}`) })
  await expect.element(row).toHaveTextContent(NOT_SET)
  const detail = page.getByRole('main', { name: NEW_TUNES })
  const settings = async () => (await db.user_settings.toArray())[0]
  await detail
    .getByRole('radiogroup', { name: NEW_TUNE_STATUS_LABEL })
    .getByRole('radio', { name: STATUS_LABELS.known })
    .click()
  await expect.poll(async () => (await settings())?.new_tune_status).toBe('known')
  await detail.getByRole('combobox', { name: NEW_TUNE_GENRE_LABEL }).click()
  await page.getByRole('option', { name: 'Irish', exact: true }).click()
  await expect.poll(async () => (await settings())?.new_tune_genre).toBe('Irish')
  await expect.element(row).toHaveTextContent('Irish')
})

it('applies the dark scheme when Appearance is set to Dark', async () => {
  onTestFinished(() => {
    setAppearance('system')
    localStorage.removeItem(APPEARANCE_KEY)
  })
  await mount('/settings/appearance', WIDE)
  const detail = page.getByRole('main', { name: APPEARANCE })
  await detail.getByRole('button', { name: new RegExp(THEME_LABEL) }).click()
  await page.getByRole('option', { name: APPEARANCE_LABELS.dark }).click()
  await expect.poll(() => document.documentElement.dataset.scheme).toBe('dark')
  await expect
    .element(categories().getByRole('row', { name: new RegExp(`^${APPEARANCE}`) }))
    .toHaveTextContent(APPEARANCE_LABELS.dark)
})

it('reports the theme and the text size step each time they change', async () => {
  onTestFinished(() => {
    setAppearance('system')
    setTextSize('regular')
    localStorage.removeItem(APPEARANCE_KEY)
    localStorage.removeItem(TEXT_SIZE_KEY)
  })
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/settings/appearance',
    db: openTestDb(),
    frame: WIDE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  const detail = page.getByRole('main', { name: APPEARANCE })
  await detail.getByRole('button', { name: new RegExp(THEME_LABEL) }).click()
  await page.getByRole('option', { name: APPEARANCE_LABELS.dark }).click()
  await expect.poll(() => analytics.sends()).toHaveLength(1)
  await detail.getByRole('button', { name: new RegExp(TEXT_SIZE_LABEL) }).click()
  await page.getByRole('option', { name: TEXT_SIZE_LABELS.roomy }).click()
  await expect.poll(() => analytics.sends()).toHaveLength(2)
  await detail.getByRole('button', { name: new RegExp(TEXT_SIZE_LABEL) }).click()
  await page.getByRole('option', { name: TEXT_SIZE_LABELS.compact }).click()
  await expect.poll(() => analytics.sends()).toHaveLength(3)
  expect(analytics.sends()).toEqual([
    { name: 'setting_changed', props: { setting: 'appearance', value: 'dark' } },
    { name: 'setting_changed', props: { setting: 'text_size', value: 1 } },
    { name: 'setting_changed', props: { setting: 'text_size', value: -1 } },
  ])
})

it('shows Offline as the account block’s second line while sync is offline', async () => {
  await mount('/settings', PHONE, { sync: { status: () => 'offline' } })
  const line = account().getByText(OFFLINE, { exact: true })
  await expect.element(line).toBeVisible()
  await expect.element(line).toHaveClass('text-warning')
  await account().click()
  await expect.element(page.getByRole('heading', { level: 1, name: ACCOUNT })).toBeVisible()
})

it('keeps Delete account disabled until the confirmation text matches', async () => {
  await mount('/settings/account', WIDE)
  await page
    .getByRole('main', { name: ACCOUNT })
    .getByRole('button', { name: DELETE_ACCOUNT })
    .click()
  const sheet = page.getByRole('dialog', { name: DELETE_ACCOUNT })
  const confirm = sheet.getByRole('button', { name: DELETE_ACCOUNT })
  await expect.element(confirm).toBeDisabled()
  const field = sheet.getByRole('textbox', { name: CONFIRM_LABEL })
  await userEvent.type(field, DELETE_CONFIRMATION_TEXT.slice(0, -1))
  await expect.element(confirm).toBeDisabled()
  await userEvent.type(field, DELETE_CONFIRMATION_TEXT.slice(-1))
  await expect.element(confirm).toBeEnabled()
  // Typed work locks the sheet: Escape leaves it open. A sheet on its way out keeps its last
  // content, so the field taking more text is what shows it stayed.
  let escaped = false
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Escape') escaped = true
  }
  window.addEventListener('keyup', onKeyUp, true)
  onTestFinished(() => window.removeEventListener('keyup', onKeyUp, true))
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => escaped).toBe(true)
  await userEvent.type(field, 'S')
  await expect.element(field).toHaveValue(`${DELETE_CONFIRMATION_TEXT}S`)
  await expect.element(confirm).toBeDisabled()
})
