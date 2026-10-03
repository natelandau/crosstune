import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { openPickerRow } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { setAppearance, setTextSize } from './appearance'
import { APPEARANCE_FOOTER, AppearanceGroup, TEXT_SIZE_LABEL } from './AppearanceGroup'

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

const show = () => renderIonic(<AppearanceGroup />, { db })

/** The name a screen reader announces for a row: the field and the option it holds. */
const named = (name: string) => page.getByRole('button', { name, exact: true })

async function choose(row: string, option: string) {
  await openPickerRow(row)
  await page.getByRole('radio', { name: option, exact: true }).click()
}

describe('AppearanceGroup', () => {
  it('holds both settings as rows of one card', async () => {
    show()
    await expect.element(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible()
    await expect.poll(() => document.querySelectorAll('ion-list')).toHaveLength(1)
    await expect
      .poll(() =>
        Array.from(document.querySelectorAll('[data-row-label]')).map((label) => label.textContent),
      )
      .toEqual(['Theme', TEXT_SIZE_LABEL])
  })

  it('starts the theme on System with no data-theme set', async () => {
    show()
    await expect.element(named('Theme, System')).toBeInTheDocument()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('sets the theme to dark, then back to system', async () => {
    show()
    await choose('Theme, System', 'Dark')
    await expect.poll(() => document.documentElement.getAttribute('data-theme')).toBe('dark')
    await expect
      .poll(() => document.documentElement.classList.contains('ion-palette-dark'))
      .toBe(true)
    await expect.poll(() => localStorage.getItem('crosstune.appearance')).toBe('dark')
    await expect.element(named('Theme, Dark')).toBeInTheDocument()

    await choose('Theme, Dark', 'System')
    await expect.poll(() => document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('starts text size on Regular with no data-text-size set', async () => {
    show()
    await expect.element(named('Text size, Regular')).toBeInTheDocument()
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })

  it('sets text size to roomy, then back to regular', async () => {
    show()
    await choose('Text size, Regular', 'Roomy')
    await expect.poll(() => document.documentElement.getAttribute('data-text-size')).toBe('roomy')
    await expect.poll(() => localStorage.getItem('crosstune.textSize')).toBe('roomy')
    await expect.element(named('Text size, Roomy')).toBeInTheDocument()

    await choose('Text size, Roomy', 'Regular')
    await expect.poll(() => document.documentElement.hasAttribute('data-text-size')).toBe(false)
  })

  it('says the choices are per device and that System follows the phone', async () => {
    show()
    await expect.element(page.getByText(APPEARANCE_FOOTER)).toBeVisible()
  })

  it('gives every row a tap target a finger can hit', async () => {
    show()
    await expect.element(named('Theme, System')).toBeInTheDocument()
    for (const item of document.querySelectorAll('ion-item')) {
      await expect.poll(() => item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  })
})
