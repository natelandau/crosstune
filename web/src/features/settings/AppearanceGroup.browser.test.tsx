import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { setAppearance, setTextSize } from './appearance'
import { AppearanceGroup } from './AppearanceGroup'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-text-size')
  document.documentElement.classList.remove('ion-palette-dark')
  // setAppearance/setTextSize also reset the module's cached choice, which a prior test's
  // clicks would otherwise leave pointed at a non-default value.
  setAppearance('system')
  setTextSize('regular')
})

afterEach(async () => {
  await db.delete()
})

const show = () => renderIonic(<AppearanceGroup />, { db })

const themeTab = (name: string) => page.getByRole('tab', { name })
const textSizeTab = (name: string) => page.getByRole('tab', { name })

describe('AppearanceGroup', () => {
  it('starts the theme on System with no data-theme set', async () => {
    show()
    await expect.element(themeTab('System')).toHaveAttribute('aria-selected', 'true')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('sets the theme to dark, then back to system', async () => {
    show()
    await themeTab('Dark').click({ force: true })
    await expect.poll(() => document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(true)
    expect(localStorage.getItem('crosstune.appearance')).toBe('dark')

    await themeTab('System').click({ force: true })
    await expect.poll(() => document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('starts text size on Regular with no data-text-size set', async () => {
    show()
    await expect.element(textSizeTab('Regular')).toHaveAttribute('aria-selected', 'true')
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })

  it('sets text size to roomy, then back to regular', async () => {
    show()
    await textSizeTab('Roomy').click({ force: true })
    await expect.poll(() => document.documentElement.getAttribute('data-text-size')).toBe('roomy')
    expect(localStorage.getItem('crosstune.textSize')).toBe('roomy')

    await textSizeTab('Regular').click({ force: true })
    await expect.poll(() => document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })

  it('explains that System follows the phone', async () => {
    show()
    await expect.element(page.getByText('System follows the phone when it switches.')).toBeVisible()
  })

  it('gives every segment button a tap target a finger can hit', async () => {
    show()
    await expect.element(themeTab('System')).toBeVisible()
    for (const button of document.querySelectorAll('ion-segment-button')) {
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
