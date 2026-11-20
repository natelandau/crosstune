import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { APP_STORE_URL, startInstallOffer } from '../../platform/installOffer'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import {
  APP_STORE,
  APP_STORE_QR,
  CROSSTUNE_FOR_IPHONE,
  DOWNLOAD_ON_APP_STORE,
  GET_THE_APP_LINE,
  GET_THE_APP,
  INSTALL_CROSSTUNE,
  SETTINGS_CATEGORIES,
} from './settingsCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const MAC = 'MacIntel'
const ANDROID = 'Linux armv8l'
const WINDOWS = 'Win32'
const IPHONE = 'iPhone'

/** Sets the browser's platform until the test ends; the runner's own names its host. */
function stubPlatform(platform: string) {
  const spy = vi.spyOn(Navigator.prototype, 'platform', 'get').mockReturnValue(platform)
  onTestFinished(() => spy.mockRestore())
}

/** Sets the platform and starts the install listener, both undone after the test. */
function startAs(platform: string) {
  stubPlatform(platform)
  onTestFinished(startInstallOffer())
}

function sendInstallPrompt(
  outcome: 'accepted' | 'dismissed',
  prompt = vi.fn(() => Promise.resolve()),
) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  window.dispatchEvent(event)
  return { event, prompt }
}

const settings = (density: 'touch' | 'pointer' = 'touch') =>
  renderApp({ path: '/settings', db: openTestDb(), density })
const entry = (name: string) => page.getByRole('row', { name })
const IPHONE_ROW = `${CROSSTUNE_FOR_IPHONE}, ${APP_STORE}`

it.each([
  ['an Apple device', MAC, 'pointer', `${GET_THE_APP}, ${APP_STORE}`],
  ['a phone', ANDROID, 'touch', IPHONE_ROW],
] as const)('opens the App Store from %s', async (_, platform, density, row) => {
  startAs(platform)
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  onTestFinished(() => open.mockRestore())
  await settings(density)
  await entry(row).click()
  await expect.poll(() => open.mock.calls.length).toBe(1)
  expect(open.mock.calls[0]?.[0]).toBe(APP_STORE_URL)
})

it('shows an iPhone a box with the App Store badge in place of the row', async () => {
  startAs(IPHONE)
  await settings('touch')
  const box = page.getByRole('link', { name: new RegExp(GET_THE_APP_LINE) })
  await expect.element(box).toHaveAttribute('href', APP_STORE_URL)
  await expect.element(box).toHaveAccessibleName(new RegExp(CROSSTUNE_FOR_IPHONE))
  await expect.element(box.getByRole('img', { name: DOWNLOAD_ON_APP_STORE })).toBeVisible()
  await expect.element(entry(`${GET_THE_APP}, ${APP_STORE}`)).not.toBeInTheDocument()
})

it('shows a computer the iPhone app as a code to scan, and never the install prompt', async () => {
  startAs(WINDOWS)
  sendInstallPrompt('accepted')
  await settings('pointer')
  await expect.element(page.getByRole('img', { name: APP_STORE_QR })).toBeVisible()
  await expect
    .element(page.getByRole('link', { name: new RegExp(CROSSTUNE_FOR_IPHONE) }))
    .toHaveAttribute('href', APP_STORE_URL)
  await expect.element(entry(INSTALL_CROSSTUNE)).not.toBeInTheDocument()
})

it.each(['accepted', 'dismissed'] as const)(
  'opens the install prompt once, and hides it after the person has %s',
  async (outcome) => {
    startAs(ANDROID)
    const { event, prompt } = sendInstallPrompt(outcome)
    expect(event.defaultPrevented).toBe(true)
    await settings()
    await entry(INSTALL_CROSSTUNE).click()
    await expect.poll(() => prompt.mock.calls.length).toBe(1)
    await expect.element(entry(INSTALL_CROSSTUNE)).not.toBeInTheDocument()
    await expect.element(entry(IPHONE_ROW)).toBeVisible()
  },
)

it('hides the install prompt when the browser installs the app from its own menu', async () => {
  startAs(ANDROID)
  sendInstallPrompt('accepted')
  await settings()
  await expect.element(entry(INSTALL_CROSSTUNE)).toBeVisible()
  window.dispatchEvent(new Event('appinstalled'))
  await expect.element(entry(INSTALL_CROSSTUNE)).not.toBeInTheDocument()
})

it('shows no entry until the app starts the install listener', async () => {
  stubPlatform(MAC)
  await settings()
  await expect.element(page.getByRole('grid', { name: SETTINGS_CATEGORIES })).toBeVisible()
  await expect.element(page.getByRole('grid', { name: GET_THE_APP })).not.toBeInTheDocument()
})

it('keeps the install prompt when the listener is started a second time and stopped', async () => {
  startAs(ANDROID)
  sendInstallPrompt('accepted')
  startInstallOffer()()
  await settings()
  await expect.element(entry(INSTALL_CROSSTUNE)).toBeVisible()
})

it.each([
  ['the person installs', () => userEvent.keyboard('{Enter}')],
  ['the browser installs from its own menu', () => window.dispatchEvent(new Event('appinstalled'))],
])('keeps keyboard focus on the page when %s', async (_, hide) => {
  startAs(ANDROID)
  sendInstallPrompt('accepted')
  await settings()
  await expect.element(entry(INSTALL_CROSSTUNE)).toBeVisible()
  ;(entry(INSTALL_CROSSTUNE).element() as HTMLElement).focus()
  await hide()
  await expect.element(entry(INSTALL_CROSSTUNE)).not.toBeInTheDocument()
  await expect.poll(() => document.activeElement !== document.body).toBe(true)
})

it('hides the install prompt quietly when the browser refuses to open it', async () => {
  startAs(ANDROID)
  const prompt = vi.fn(() =>
    Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
  )
  sendInstallPrompt('dismissed', prompt)
  await settings()
  await entry(INSTALL_CROSSTUNE).click()
  await expect.poll(() => prompt.mock.calls.length).toBe(1)
  await expect.element(entry(INSTALL_CROSSTUNE)).not.toBeInTheDocument()
})
