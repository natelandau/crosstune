import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { glyphContrast } from '../test/contrast'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { KeyPill } from './KeyPill'

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const pills = () => Array.from(document.querySelectorAll('.key-pill'))

afterEach(() => document.documentElement.classList.remove('ion-palette-dark'))

describe('KeyPill', () => {
  it('shows the key and tags it with its pitch class', async () => {
    renderIonic(<KeyPill value="D" />, { db: openTestDb() })
    await expect.element(page.getByText('D', { exact: true })).toBeVisible()
    expect(pills()[0]!.getAttribute('data-pitch')).toBe('2')
  })

  it('gives one enharmonic pair one color', async () => {
    renderIonic(
      <>
        <KeyPill value="Bb" />
        <KeyPill value="A#" />
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Bb', { exact: true })).toBeVisible()
    const [flat, sharp] = pills()
    expect(getComputedStyle(flat!).backgroundColor).toBe(getComputedStyle(sharp!).backgroundColor)
  })

  it('keeps the pill but drops the pitch for text that is not a key', async () => {
    renderIonic(<KeyPill value="Am" />, { db: openTestDb() })
    await expect.element(page.getByText('Am', { exact: true })).toBeVisible()
    expect(pills()[0]!.hasAttribute('data-pitch')).toBe(false)
  })

  it('sits shorter in a row than it does in a rail', async () => {
    renderIonic(
      <>
        <KeyPill value="D" />
        <KeyPill value="D" compact />
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('D', { exact: true }).first()).toBeVisible()
    const [full, compact] = pills().map((pill) => pill.getBoundingClientRect().height)
    expect(full).toBeGreaterThan(compact!)
  })

  it('renders nothing for an empty value', () => {
    renderIonic(<KeyPill value="  " />, { db: openTestDb() })
    expect(pills()).toHaveLength(0)
  })

  it.each(['light', 'dark'])('clears 4.5:1 at rest in %s', async (theme) => {
    // The palette goes on before the render, as it does at boot.
    document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')
    renderIonic(
      <>
        {KEYS.map((key) => (
          <KeyPill key={key} value={key} />
        ))}
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('C', { exact: true })).toBeVisible()
    expect(pills()).toHaveLength(KEYS.length)
    for (const pill of pills())
      expect(glyphContrast(pill), `${theme} ${pill.textContent}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['light', 'dark'])('clears 4.5:1 when chosen in %s', async (theme) => {
    document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')
    renderIonic(
      <>
        {KEYS.map((key) => (
          <KeyPill key={key} value={key} chosen />
        ))}
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('C', { exact: true })).toBeVisible()
    expect(pills()).toHaveLength(KEYS.length)
    for (const pill of pills())
      expect(glyphContrast(pill), `${theme} ${pill.textContent}`).toBeGreaterThanOrEqual(4.5)
  })

  it('follows a theme change after it has rendered', async () => {
    renderIonic(<KeyPill value="D" />, { db: openTestDb() })
    await expect.element(page.getByText('D', { exact: true })).toBeVisible()
    const pill = pills()[0]!
    const light = getComputedStyle(pill).backgroundColor
    document.documentElement.classList.add('ion-palette-dark')
    expect(getComputedStyle(pill).backgroundColor).not.toBe(light)
  })
})
