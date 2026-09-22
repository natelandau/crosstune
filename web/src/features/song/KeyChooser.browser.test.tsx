import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { KeyChooser } from './KeyChooser'
import { ALL_KEYS, QUICK_KEYS } from './suggestions'

function Host({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <KeyChooser value={value} onChange={setValue} />
      <p data-state>{value === '' ? 'empty' : value}</p>
    </>
  )
}

const state = () => document.querySelector('[data-state]')!.textContent
const chip = (name: string) => page.getByRole('button', { name, exact: true })
const rest = ALL_KEYS.filter((key) => !(QUICK_KEYS as readonly string[]).includes(key))

/** The open menu's item labels, whichever overlay the pointer calls for. */
async function menuLabels(): Promise<string[]> {
  const open = () =>
    document.querySelector(
      'ion-action-sheet:not(.overlay-hidden), ion-popover:not(.overlay-hidden)',
    )
  await vi.waitFor(() => expect(open()).toBeTruthy())
  const sheet = document.querySelector('ion-action-sheet:not(.overlay-hidden)')
  if (sheet) {
    await vi.waitFor(() =>
      expect(sheet.shadowRoot?.querySelector('.action-sheet-button')).toBeTruthy(),
    )
    return Array.from(sheet.shadowRoot!.querySelectorAll('.action-sheet-button'))
      .map((button) => button.textContent!.trim())
      .filter((label) => label !== 'Cancel')
  }
  const popover = open()!
  await vi.waitFor(() => expect(popover.querySelector('ion-label')).toBeTruthy())
  return Array.from(popover.querySelectorAll('ion-label')).map((label) => label.textContent!.trim())
}

describe('KeyChooser', () => {
  it('presses the unknown chip for an empty key', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Unknown key')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the unknown chip first, then the quick keys, then More keys', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Unknown key')).toBeVisible()
    const labels = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Key"] button'),
    ).map((button) => button.textContent!.trim())
    // The unknown chip carries an icon, so its text is empty.
    expect(labels).toEqual(['', ...QUICK_KEYS, 'More keys…'])
  })

  it('names the unknown chip in words, since an icon reads as nothing aloud', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Unknown key')).toBeVisible()
    // It must not collide with the status control's own Unknown, a few rows above it.
    expect(page.getByRole('button', { name: 'Unknown', exact: true }).elements()).toHaveLength(0)
  })

  it('sets a key in one tap and clears it from Unknown or the pressed key', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await chip('D').click()
    await expect.poll(state).toBe('D')
    await expect.element(chip('D')).toHaveAttribute('aria-pressed', 'true')
    await chip('Unknown key').click()
    await expect.poll(state).toBe('empty')
    await chip('D').click()
    await expect.poll(state).toBe('D')
    await chip('D').click()
    await expect.poll(state).toBe('empty')
  })

  it('fills the chosen key in its own hue rather than the primary tint', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    const pill = () => document.querySelector('.key-pill[data-pitch="2"]')!
    await expect.element(chip('D')).toBeVisible()
    const resting = getComputedStyle(pill()).backgroundColor
    await chip('D').click()
    await expect.poll(() => pill().hasAttribute('data-chosen')).toBe(true)
    expect(getComputedStyle(pill()).backgroundColor).not.toBe(resting)
  })

  it('lists every key the grid does not already show, in order', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await chip('More keys…').click()
    expect(await menuLabels()).toEqual([...rest])
  })

  it('gives F sharp and G flat the same hue', async () => {
    renderIonic(
      <>
        <KeyChooser value="F#" onChange={() => {}} />
        <KeyChooser value="Gb" onChange={() => {}} />
      </>,
      { db: openTestDb() },
    )
    await expect.element(chip('F#')).toBeVisible()
    const sharp = document.querySelectorAll('.key-pill[data-pitch="6"]')
    expect(sharp).toHaveLength(2)
    expect(getComputedStyle(sharp[0]!).backgroundColor).toBe(
      getComputedStyle(sharp[1]!).backgroundColor,
    )
  })

  it('keeps a stored value it cannot read as a key, and lets it be cleared', async () => {
    renderIonic(<Host initial="modal G" />, { db: openTestDb() })
    await expect.element(chip('modal G')).toHaveAttribute('aria-pressed', 'true')
    const pill = document.querySelector('.key-pill[data-chosen]')!
    expect(pill.hasAttribute('data-pitch')).toBe(false)
    await chip('modal G').click()
    await expect.poll(state).toBe('empty')
    // Cleared, it is no longer one of the grid's choices.
    await expect.poll(() => document.querySelectorAll('.key-pill').length).toBe(QUICK_KEYS.length)
  })

  it('names the grid and keeps every chip at the 44px tap height', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Unknown key')).toBeVisible()
    const grid = document.querySelector('[role="group"][aria-label="Key"]')!
    for (const button of grid.querySelectorAll('button')) {
      const box = button.getBoundingClientRect()
      expect(box.height, button.textContent ?? '').toBeGreaterThanOrEqual(44)
      expect(box.width, button.textContent ?? '').toBeGreaterThanOrEqual(44)
    }
  })

  it('wraps inside the gutters at phone width on the roomy text size', async () => {
    document.documentElement.setAttribute('data-text-size', 'roomy')
    try {
      renderIonic(
        <div style={{ width: '393px' }}>
          <Host />
        </div>,
        { db: openTestDb() },
      )
      await expect.element(chip('Unknown key')).toBeVisible()
      const grid = document.querySelector('[role="group"][aria-label="Key"]') as HTMLElement
      expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1)
    } finally {
      document.documentElement.removeAttribute('data-text-size')
    }
  })

  it("takes a caller's own name for the empty choice", async () => {
    renderIonic(<KeyChooser value="" onChange={() => {}} emptyLabel="Clear the key" />, {
      db: openTestDb(),
    })
    await expect.element(chip('Clear the key')).toBeVisible()
  })
})
