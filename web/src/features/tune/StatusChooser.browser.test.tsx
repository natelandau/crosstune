import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { TuneStatus } from '../../api/vocabulary'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { StatusChooser } from './StatusChooser'

function Host({ initial = 'want_to_learn' }: { initial?: TuneStatus }) {
  const [value, setValue] = useState<TuneStatus>(initial)
  return (
    <>
      <StatusChooser value={value} onChange={setValue} />
      <p data-state>{value}</p>
    </>
  )
}

const state = () => document.querySelector('[data-state]')!.textContent
const chip = (name: string) => page.getByRole('button', { name, exact: true })

describe('StatusChooser', () => {
  it('offers the three statuses in order, named as a group', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Known')).toBeVisible()
    const labels = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Status"] button'),
    ).map((button) => button.textContent!.trim())
    expect(labels).toEqual(['Known', 'Learning', 'Unknown'])
  })

  it('presses the current status', async () => {
    renderIonic(<Host initial="learning" />, { db: openTestDb() })
    await expect.element(chip('Learning')).toHaveAttribute('aria-pressed', 'true')
    await expect.element(chip('Known')).toHaveAttribute('aria-pressed', 'false')
  })

  it('sets a status in one tap', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await chip('Known').click()
    await expect.poll(state).toBe('known')
    await chip('Learning').click()
    await expect.poll(state).toBe('learning')
  })

  it('never clears, since a tune always has a status', async () => {
    renderIonic(<Host initial="known" />, { db: openTestDb() })
    await chip('Known').click()
    await expect.poll(state).toBe('known')
    await expect.element(chip('Known')).toHaveAttribute('aria-pressed', 'true')
  })

  it('pairs each label with its dot, and keeps the dot visible when chosen', async () => {
    renderIonic(<Host initial="known" />, { db: openTestDb() })
    await expect.element(chip('Known')).toBeVisible()
    const dots = document.querySelectorAll('[role="group"][aria-label="Status"] [data-status-dot]')
    expect(dots).toHaveLength(3)
    const chosen = document.querySelector(
      'button[aria-pressed="true"] [data-status-dot]',
    ) as HTMLElement
    const capsule = chosen.parentElement as HTMLElement
    // The chosen capsule fills with primary, and success is that same slate, so a dot that kept
    // its resting color would disappear into the fill it sits on.
    expect(getComputedStyle(chosen).backgroundColor).not.toBe(
      getComputedStyle(capsule).backgroundColor,
    )
  })

  it('leads with All where it filters rather than edits', async () => {
    function Filter() {
      const [value, setValue] = useState<TuneStatus | 'all'>('all')
      return (
        <>
          <StatusChooser value={value} onChange={setValue} includeAll />
          <p data-state>{value}</p>
        </>
      )
    }
    renderIonic(<Filter />, { db: openTestDb() })
    await expect.element(chip('All')).toBeVisible()
    const labels = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Status"] button'),
    ).map((button) => button.textContent!.trim())
    expect(labels).toEqual(['All', 'Known', 'Learning', 'Unknown'])
    await expect.element(chip('All')).toHaveAttribute('aria-pressed', 'true')
    await chip('Learning').click()
    await expect.poll(state).toBe('learning')
    await expect.element(chip('All')).toHaveAttribute('aria-pressed', 'false')
    // A filter can be widened again, unlike the form's, which always holds a status.
    await chip('All').click()
    await expect.poll(state).toBe('all')
  })

  it('keeps every choice at the 44px tap height', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(chip('Known')).toBeVisible()
    const group = document.querySelector('[role="group"][aria-label="Status"]')!
    for (const button of group.querySelectorAll('button')) {
      const box = button.getBoundingClientRect()
      expect(box.height, button.textContent ?? '').toBeGreaterThanOrEqual(44)
      expect(box.width, button.textContent ?? '').toBeGreaterThanOrEqual(44)
    }
  })
})
