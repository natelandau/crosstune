import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useState } from 'react'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { PITCH } from '../recording-screen/PitchPanel'
import { SPEED } from '../recording-screen/SpeedPanel'
import { ModeControls, ModeSelector } from './ModePanel'
import { LOOPS_LABEL, SEGMENT_LABEL } from './practiceCopy'
import { MODE_KEY, usePracticeMode } from './usePracticeMode'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  localStorage.removeItem(MODE_KEY)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
})

function Harness({ speed = 100, pitch = 0 }: { speed?: number; pitch?: number }) {
  const [mode, setMode] = usePracticeMode()
  return (
    <>
      <ModeSelector mode={mode} onMode={setMode} speedPercent={speed} pitchCents={pitch} />
      <ModeControls
        mode={mode}
        speedPercent={speed}
        pitchCents={pitch}
        onSpeed={() => {}}
        onPitch={() => {}}
        loops={<p>loops body</p>}
      />
    </>
  )
}

const segment = (name: string) => page.getByRole('tab', { name, exact: true })

describe('ModeSelector and ModeControls', () => {
  it('shows the three modes with values off default', async () => {
    renderIonic(<Harness speed={75} pitch={200} />, { db })
    await expect.element(segment(LOOPS_LABEL)).toBeVisible()
    await expect.element(segment(SEGMENT_LABEL(SPEED, '75%'))).toBeVisible()
    await expect.element(segment(SEGMENT_LABEL(PITCH, '+2'))).toBeVisible()
  })

  it('shows bare names at the defaults', async () => {
    renderIonic(<Harness />, { db })
    await expect.element(segment(SPEED)).toBeVisible()
    await expect.element(segment(PITCH)).toBeVisible()
  })

  it('swaps the panel for the chosen mode', async () => {
    renderIonic(<Harness />, { db })
    await expect.element(page.getByText('loops body')).toBeVisible()
    await segment(SPEED).click({ force: true })
    await expect.element(page.getByRole('slider', { name: SPEED })).toBeVisible()
    await expect.element(page.getByText('loops body')).not.toBeVisible()
  })

  it('keeps one height whichever panel shows, the tallest one’s', async () => {
    renderIonic(<Harness />, { db })
    const block = () => document.querySelector('[data-mode-controls]')!.getBoundingClientRect()
    await expect.element(page.getByText('loops body')).toBeVisible()
    const height = block().height
    const tallest = Math.max(
      ...Array.from(
        document.querySelectorAll('[data-mode-panel]'),
        (panel) => panel.getBoundingClientRect().height,
      ),
    )
    expect(height).toBe(tallest)
    for (const name of [SPEED, PITCH, LOOPS_LABEL]) {
      await segment(name).click({ force: true })
      await expect.element(segment(name)).toHaveAttribute('aria-selected', 'true')
      expect(block().height).toBe(height)
    }
    // Only the chosen panel's controls can be reached.
    expect(page.getByRole('slider', { name: SPEED }).elements()).toHaveLength(0)
  })

  it('remembers the last mode', async () => {
    const first = renderIonic(<Harness />, { db })
    await segment(PITCH).click({ force: true })
    expect(localStorage.getItem(MODE_KEY)).toBe('pitch')
    first.unmount()
    renderIonic(<Harness />, { db })
    await expect.element(segment(PITCH)).toHaveAttribute('aria-selected', 'true')
  })

  it('works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    function Wrapper() {
      const [shown] = useState(true)
      return shown ? <Harness /> : null
    }
    renderIonic(<Wrapper />, { db })
    await expect.element(page.getByText('loops body')).toBeVisible()
    await segment(SPEED).click({ force: true })
    await expect.element(segment(SPEED)).toHaveAttribute('aria-selected', 'true')
  })
})
