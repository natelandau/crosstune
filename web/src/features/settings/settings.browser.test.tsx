import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { setInstruments } from '../../commands/settings'
import {
  AUDIO_QUALITY_NAMES,
  INSTRUMENT_LABELS,
  PROVIDER_LABELS,
  STATUS_LABELS,
} from '../../constants'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import { RECORDING } from '../../text/format'
import { placeRow } from '../../test/rows'
import { LOCATION_ACCESS_OFF, SAVED_LOCATIONS, STORAGE_USED } from '../recordings/recordingsCopy'
import {
  APPEARANCE_KEY,
  APPEARANCE_LABELS,
  setAppearance,
  setTextSize,
  TEXT_SIZE_KEY,
  TEXT_SIZE_LABELS,
} from '../../theme/appearance'
import { CONFIRM_LABEL, DELETE_ACCOUNT, DELETE_CONFIRMATION_TEXT } from './deleteAccountCopy'
import { NEW_TUNE_GENRE_LABEL, NEW_TUNE_STATUS_LABEL, NEW_TUNES_HELP } from './newTunes'
import { PLAY_FIRST_LABEL } from './playFirst'
import { KEEP_OFFLINE_LABEL } from './recordingCopy'
import { MUSIC_SERVICES, SEARCHABLE_PROVIDERS } from './searchProviders'
import {
  LEGACY_SETTINGS_PAGES,
  SETTINGS_GROUPS,
  settingsGroupPath,
  settingsPagePath,
} from './settingsPaths'
import {
  ACCOUNT,
  a4Label,
  APPEARANCE,
  TUNER_SETTINGS_TITLE,
  DOWNLOADS,
  EXPORT_HEADER,
  EXPORT_HELP,
  IMPORT_AND_EXPORT,
  IMPORT_HEADER,
  IMPORT_HELP,
  INSTRUMENTS,
  MORE_INFO,
  NEW_TUNES,
  QUALITY_LABEL,
  RECORDINGS_SETTINGS,
  REMOVE_DOWNLOADS,
  SIGN_OUT,
  SYNC_AND_STORAGE,
  SYNC_NOW,
  TEXT_SIZE_LABEL,
  THEME_LABEL,
  SETTINGS_CATEGORIES,
  TUNES,
} from './settingsCopy'
import { formatRecorded } from '../stats/formatRecorded'
import { OFFLINE } from '../../sync/labels'
import { openTestDb } from '../../test/db'
import { fakeLocationPermissionForTest } from '../../test/fakeLocationPermission'
import { dataProviders, testSession } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { IMPORT_HELP_URL, IMPORT_TUNES } from '../import/importCopy'
import { EXPORT_ACTION, EXPORT_DATA, EXPORT_TITLE } from './export/exportCopy'
import { NOT_SET } from '../../ui/fieldCopy'
import { destination } from '../../layout/destinations'
import { STUB_USER_NAME } from '../../fixture/clerkStub'
import { renderApp } from '../../test/renderApp'
import { ImportExportPage } from './pages/ImportExportPage'
import { NO_SETTING_SELECTED } from './SettingsLayout'
import { settingsPageSpec } from './settingsPages'

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
const groupHeadings = (detail: ReturnType<typeof page.getByRole>) => () =>
  detail
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent)

it('root lists Tunes, Recordings, Appearance, Tuner, Sync and storage, Import and export', async () => {
  await mount('/settings', PHONE, { before: (db) => setInstruments(db, 'user_1', ['violin']) })
  await expect.element(page.getByRole('heading', { level: 1, name: SETTINGS.label })).toBeVisible()
  await expect
    .poll(rowTitles)
    .toEqual([
      TUNES,
      RECORDINGS_SETTINGS,
      APPEARANCE,
      TUNER_SETTINGS_TITLE,
      SYNC_AND_STORAGE,
      IMPORT_AND_EXPORT,
    ])
  const row = (name: string) => categories().getByRole('row', { name: new RegExp(`^${name}`) })
  await expect.element(row(TUNES)).toHaveTextContent(INSTRUMENT_LABELS.violin)
  await expect.element(row(RECORDINGS_SETTINGS)).toHaveTextContent(AUDIO_QUALITY_NAMES.standard)
  await expect.element(row(APPEARANCE)).toHaveTextContent(APPEARANCE_LABELS.system)
  await expect.element(row(TUNER_SETTINGS_TITLE)).toHaveTextContent(a4Label(440))
  await expect.element(account()).toBeVisible()
  // The phone has no detail column, so nothing takes the place of a page.
  await expect.element(page.getByText(NO_SETTING_SELECTED)).not.toBeInTheDocument()
})

it('pushes a category on the phone, and Back returns to the categories', async () => {
  const { router } = await mount('/settings')
  await categories()
    .getByRole('row', { name: new RegExp(`^${TUNES}`) })
    .click()
  await expect.poll(at(router)).toBe(settingsPagePath('tunes'))
  await expect.element(page.getByRole('heading', { level: 1, name: TUNES })).toBeVisible()
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
  const { router } = await mount(settingsPagePath('tunes'), WIDE)
  const tunes = categories().getByRole('row', { name: new RegExp(`^${TUNES}`) })
  await expect.element(tunes).toHaveAttribute('aria-selected', 'true')
  ;(tunes.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.poll(at(router)).toBe(settingsPagePath('recordings'))
  expect(router.state.historyAction).toBe('REPLACE')
  await expect
    .element(
      page
        .getByRole('main', { name: RECORDINGS_SETTINGS })
        .getByRole('heading', { level: 1, name: RECORDINGS_SETTINGS }),
    )
    .toBeVisible()
  await expect
    .element(categories().getByRole('row', { name: new RegExp(`^${RECORDINGS_SETTINGS}`) }))
    .toHaveAttribute('aria-selected', 'true')
})

it('Tunes shows instrument and service switches and new-tune defaults', async () => {
  await mount(settingsPagePath('tunes'), WIDE)
  const detail = page.getByRole('main', { name: TUNES })
  const group = (name: string) => detail.getByRole('region', { name })
  await expect
    .element(group(INSTRUMENTS).getByRole('switch', { name: INSTRUMENT_LABELS.violin }))
    .toBeVisible()
  await expect
    .element(group(NEW_TUNES).getByRole('button', { name: new RegExp(NEW_TUNE_STATUS_LABEL) }))
    .toBeVisible()
  await expect
    .element(group(NEW_TUNES).getByRole('combobox', { name: NEW_TUNE_GENRE_LABEL }))
    .toBeVisible()
  const services = group(MUSIC_SERVICES)
  for (const provider of SEARCHABLE_PROVIDERS) {
    await expect
      .element(services.getByRole('switch', { name: PROVIDER_LABELS[provider] }))
      .toBeVisible()
  }
  await expect
    .element(detail.getByRole('button', { name: new RegExp(PLAY_FIRST_LABEL) }))
    .toBeVisible()
  // Instruments, then new tunes, then the services, as the Mac's Tunes tab orders them.
  await expect.poll(groupHeadings(detail)).toEqual([INSTRUMENTS, NEW_TUNES, MUSIC_SERVICES])
})

it('Recordings shows quality, saved locations, and downloads', async () => {
  await mount(settingsPagePath('recordings'), WIDE, {
    before: (db) => db.places.bulkPut([placeRow('p1', 'Town Hall')]),
  })
  const detail = page.getByRole('main', { name: RECORDINGS_SETTINGS })
  const group = (name: string) => detail.getByRole('region', { name })
  await expect
    .element(group(RECORDING).getByRole('button', { name: new RegExp(QUALITY_LABEL) }))
    .toBeVisible()
  await expect
    .element(group(SAVED_LOCATIONS).getByRole('link', { name: /^Town Hall/ }))
    .toBeVisible()
  await expect
    .element(group(DOWNLOADS).getByRole('switch', { name: KEEP_OFFLINE_LABEL }))
    .toBeVisible()
  await expect.element(detail.getByRole('button', { name: REMOVE_DOWNLOADS })).toBeVisible()
  await expect.poll(groupHeadings(detail)).toEqual([RECORDING, SAVED_LOCATIONS, DOWNLOADS])
})

const SHORT_PHONE = { width: 390, height: 500 }
const tunesGroup = (name: string) =>
  page.getByRole('main', { name: TUNES }).getByRole('region', { name })
const topOf = (name: string) => () => tunesGroup(name).element().getBoundingClientRect().top

it.each([
  ['phone', SHORT_PHONE],
  ['wide', { width: 1280, height: 500 }],
])('scrolls to the group a link names on %s', async (_, frame) => {
  await mount(settingsGroupPath('tunes', SETTINGS_GROUPS.musicServices), frame)
  await expect.element(tunesGroup(MUSIC_SERVICES)).toBeVisible()
  // Below the pane bar and near the top, where the unscrolled page puts it well below.
  await expect.poll(topOf(MUSIC_SERVICES)).toBeLessThan(120)
  await expect.poll(topOf(MUSIC_SERVICES)).toBeGreaterThanOrEqual(44)
})

it('opens a page at its top when the address names no group', async () => {
  await mount(settingsPagePath('tunes'), SHORT_PHONE)
  await expect.element(tunesGroup(MUSIC_SERVICES)).toBeInTheDocument()
  await expect.poll(topOf(MUSIC_SERVICES)).toBeGreaterThan(120)
})

it('keeps the downloads off the Sync and storage page', async () => {
  await mount(settingsPagePath('sync'), WIDE)
  const detail = page.getByRole('main', { name: SYNC_AND_STORAGE })
  await expect.element(detail.getByRole('button', { name: SYNC_NOW })).toBeVisible()
  await expect
    .element(detail.getByRole('switch', { name: KEEP_OFFLINE_LABEL }))
    .not.toBeInTheDocument()
  await expect
    .element(detail.getByRole('button', { name: REMOVE_DOWNLOADS }))
    .not.toBeInTheDocument()
})

const LEGACY_GROUP_NAMES: Record<string, [page: string, group: string]> = {
  instruments: [TUNES, INSTRUMENTS],
  'new-tunes': [TUNES, NEW_TUNES],
  'music-services': [TUNES, MUSIC_SERVICES],
  recording: [RECORDINGS_SETTINGS, RECORDING],
  'saved-locations': [RECORDINGS_SETTINGS, SAVED_LOCATIONS],
}

it.each(Object.entries(LEGACY_SETTINGS_PAGES))(
  'old addresses redirect to their group on the merged page: %s',
  async (legacy, { page: merged, group }) => {
    const { router } = await mount(`/settings/${legacy}`, WIDE)
    await expect.poll(at(router)).toBe(settingsPagePath(merged))
    expect(router.state.location.hash).toBe(`#${group}`)
    expect(router.state.historyAction).toBe('REPLACE')
    await expect
      .element(
        categories().getByRole('row', { name: new RegExp(`^${settingsPageSpec(merged).title}`) }),
      )
      .toHaveAttribute('aria-selected', 'true')
    const [pageName, groupName] = LEGACY_GROUP_NAMES[legacy]!
    const region = page
      .getByRole('main', { name: pageName })
      .getByRole('region', { name: groupName })
    await expect.element(region).toHaveAttribute('id', group)
    await expect.element(region).toBeInViewport()
  },
)

it('maps each old address to the group that holds its setting', () => {
  expect(LEGACY_SETTINGS_PAGES).toEqual({
    instruments: { page: 'tunes', group: SETTINGS_GROUPS.instruments },
    'new-tunes': { page: 'tunes', group: SETTINGS_GROUPS.newTunes },
    'music-services': { page: 'tunes', group: SETTINGS_GROUPS.musicServices },
    recording: { page: 'recordings', group: SETTINGS_GROUPS.recording },
    'saved-locations': { page: 'recordings', group: SETTINGS_GROUPS.savedLocations },
  })
  expect(Object.keys(LEGACY_GROUP_NAMES)).toEqual(Object.keys(LEGACY_SETTINGS_PAGES))
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

it('updates the Tunes summary on the root as an instrument toggles', async () => {
  const { db } = await mount(settingsPagePath('tunes'), WIDE)
  const row = categories().getByRole('row', { name: new RegExp(`^${TUNES}`) })
  // The loaded summary, so the toggle below is what changes it.
  await expect.element(row).toHaveTextContent(NOT_SET)
  const detail = page.getByRole('main', { name: TUNES })
  // The switch's input is visually hidden, so the press lands on its label.
  await detail.getByText(INSTRUMENT_LABELS.violin, { exact: true }).click()
  await expect.element(detail.getByRole('switch', { name: INSTRUMENT_LABELS.violin })).toBeChecked()
  await expect.element(row).toHaveTextContent(INSTRUMENT_LABELS.violin)
  await expect
    .poll(async () => (await db.user_settings.toArray())[0]?.instruments)
    .toEqual(['violin'])
})

it('saves the status and genre a new tune starts with', async () => {
  const { db } = await mount(settingsPagePath('tunes'), WIDE)
  const detail = page.getByRole('main', { name: TUNES })
  const settings = async () => (await db.user_settings.toArray())[0]
  const status = detail.getByRole('button', { name: new RegExp(NEW_TUNE_STATUS_LABEL) })
  const help = detail.getByText(NEW_TUNES_HELP)
  await expect.element(status).toBeVisible()
  // A settings group's help leads its rows.
  await expect
    .poll(
      () =>
        help.element().compareDocumentPosition(status.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    .toBeTruthy()
  await status.click()
  await page.getByRole('option', { name: STATUS_LABELS.known }).click()
  await expect.poll(async () => (await settings())?.new_tune_status).toBe('known')
  await detail.getByRole('combobox', { name: NEW_TUNE_GENRE_LABEL }).click()
  await page.getByRole('option', { name: 'Irish', exact: true }).click()
  await expect.poll(async () => (await settings())?.new_tune_genre).toBe('Irish')
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
  await page.getByRole('option', { name: TEXT_SIZE_LABELS.large }).click()
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

it('says on the Recordings page that location access is off, while it is', async () => {
  const permission = fakeLocationPermissionForTest('denied')
  await mount(settingsPagePath('recordings'))
  const main = page.getByRole('main')
  await expect.element(main.getByText(LOCATION_ACCESS_OFF)).toBeVisible()
  permission.set('granted')
  await expect.element(main.getByText(LOCATION_ACCESS_OFF)).not.toBeInTheDocument()
})

it('keeps import and export off the account page', async () => {
  await mount('/settings/account', WIDE)
  const detail = page.getByRole('main', { name: ACCOUNT })
  await expect.element(detail.getByRole('button', { name: SIGN_OUT })).toBeVisible()
  await expect.element(detail.getByRole('button', { name: IMPORT_TUNES })).not.toBeInTheDocument()
  await expect.element(detail.getByRole('button', { name: EXPORT_DATA })).not.toBeInTheDocument()
})

it('shows the import and export groups on their own page', async () => {
  await mount('/settings/import-export', WIDE)
  const detail = page.getByRole('main', { name: IMPORT_AND_EXPORT })
  await expect
    .element(detail.getByRole('heading', { level: 1, name: IMPORT_AND_EXPORT }))
    .toBeVisible()
  await expect.element(detail.getByText(IMPORT_HEADER, { exact: true })).toBeVisible()
  await expect.element(detail).toHaveTextContent(IMPORT_HELP)
  await expect.element(detail.getByText(EXPORT_HEADER, { exact: true })).toBeVisible()
  await expect.element(detail.getByText(EXPORT_HELP)).toBeVisible()
  const more = detail.getByRole('link', { name: MORE_INFO })
  await expect.element(more).toHaveAttribute('href', IMPORT_HELP_URL)
  await expect.element(more).toHaveAttribute('target', '_blank')
  await expect.element(detail.getByRole('button', { name: IMPORT_TUNES })).toBeVisible()
  await expect.element(detail.getByRole('button', { name: EXPORT_DATA })).toBeVisible()
  await expect
    .element(categories().getByRole('row', { name: new RegExp(`^${IMPORT_AND_EXPORT}`) }))
    .toHaveAttribute('aria-selected', 'true')
})

it('opens import from the import and export page', async () => {
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/settings/import-export',
    db: openTestDb(),
    frame: WIDE,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await page
    .getByRole('main', { name: IMPORT_AND_EXPORT })
    .getByRole('button', { name: IMPORT_TUNES })
    .click()
  await expect.element(page.getByRole('dialog', { name: IMPORT_TUNES })).toBeVisible()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'import_started', props: { entry: 'settings' } }])
})

it('opens export from the import and export page', async () => {
  await mount('/settings/import-export', WIDE)
  await page
    .getByRole('main', { name: IMPORT_AND_EXPORT })
    .getByRole('button', { name: EXPORT_DATA })
    .click()
  const sheet = page.getByRole('dialog', { name: EXPORT_TITLE })
  await expect.element(sheet).toBeVisible()
  await expect
    .element(sheet.getByRole('button', { name: EXPORT_ACTION, exact: true }))
    .toBeVisible()
})

it('keeps import and export open to an offline session', async () => {
  const Data = dataProviders({ db: openTestDb(), session: { ...testSession, offline: true } })
  renderWithProviders(
    <Data>
      <ImportExportPage />
    </Data>,
  )
  await expect.element(page.getByRole('button', { name: IMPORT_TUNES })).toBeEnabled()
  await expect.element(page.getByRole('button', { name: EXPORT_DATA })).toBeEnabled()
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
