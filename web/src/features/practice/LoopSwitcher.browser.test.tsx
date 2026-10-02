import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecordingLoop } from '../../db/types'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { loopRow } from '../../test/rows'
import { LoopSwitcher } from './LoopSwitcher'
import { LOOP_SELECTED, NEXT_LOOP, NO_LOOP, PREVIOUS_LOOP } from './practiceCopy'
import type { LoopPlayback } from './useLoopPlayback'

let db: CrosstuneDb
beforeEach(() => {
  db = openTestDb()
})
afterEach(async () => {
  await db.delete()
})

function row(id: string, start_ms: number, end_ms: number, label: string | null = null) {
  return loopRow({ id, start_ms, end_ms, label })
}

function setup({
  loops = [],
  playheadMs = 10_000,
  selectedId = null,
  disabled = false,
}: {
  loops?: LocalRecordingLoop[]
  playheadMs?: number
  selectedId?: string | null
  disabled?: boolean
} = {}) {
  const playback: LoopPlayback = { selectedId, select: vi.fn(), hold: vi.fn() }
  const handlers = { onCommand: vi.fn(), onReveal: vi.fn(), announce: vi.fn() }
  renderIonic(
    <LoopSwitcher
      loops={loops}
      playback={playback}
      playheadMs={playheadMs}
      trimStartMs={0}
      disabled={disabled}
      {...handlers}
    />,
    { db },
  )
  return { playback, ...handlers }
}

const button = (name: string) => page.getByRole('button', { name, exact: true })

describe('LoopSwitcher', () => {
  it('shows the selected loop’s name as plain text', async () => {
    setup({ loops: [row('a', 1000, 5000, 'B part')], selectedId: 'a' })
    await expect.element(page.getByText('B part', { exact: true })).toBeVisible()
    expect(page.getByRole('button', { name: 'B part' }).elements()).toHaveLength(0)
  })

  it('names an unnamed loop by its time', async () => {
    setup({ loops: [row('a', 84_000, 90_000)], selectedId: 'a', playheadMs: 84_000 })
    await expect.element(page.getByText('Loop 1:24', { exact: true })).toBeVisible()
  })

  it('reads No loop with loops but none selected', async () => {
    setup({ loops: [row('a', 20_000, 25_000)] })
    await expect.element(page.getByText(NO_LOOP, { exact: true })).toBeVisible()
  })

  it('is absent with no loops', async () => {
    setup()
    expect(document.querySelector('[data-loop-switcher]')).toBeNull()
    expect(page.getByRole('button', { name: NEXT_LOOP }).elements()).toHaveLength(0)
  })

  it('Next selects the next loop, settles first, reveals it, and announces it', async () => {
    const t = setup({
      playheadMs: 10_000,
      loops: [row('a', 1000, 5000), row('b', 20_000, 25_000, 'B part')],
    })
    await button(NEXT_LOOP).click()
    expect(t.onCommand).toHaveBeenCalledOnce()
    expect(t.playback.select).toHaveBeenCalledWith('b')
    expect(t.onReveal).toHaveBeenCalledWith({ startMs: 20_000, endMs: 25_000 })
    expect(t.announce).toHaveBeenCalledWith(LOOP_SELECTED('B part'))
  })

  it('Previous selects the previous loop', async () => {
    const t = setup({
      playheadMs: 10_000,
      loops: [row('a', 1000, 5000), row('b', 20_000, 25_000)],
    })
    await button(PREVIOUS_LOOP).click()
    expect(t.playback.select).toHaveBeenCalledWith('a')
    expect(t.onReveal).toHaveBeenCalledWith({ startMs: 1000, endMs: 5000 })
  })

  it('steps from the selected loop to its neighbor', async () => {
    const t = setup({
      playheadMs: 20_000,
      selectedId: 'b',
      loops: [row('a', 1000, 5000), row('b', 20_000, 25_000), row('c', 30_000, 35_000)],
    })
    await button(NEXT_LOOP).click()
    expect(t.playback.select).toHaveBeenCalledWith('c')
    await button(PREVIOUS_LOOP).click()
    expect(t.playback.select).toHaveBeenLastCalledWith('a')
  })

  it('disables an arrow with no loop that way', async () => {
    setup({ playheadMs: 10_000, loops: [row('a', 20_000, 25_000)] })
    await expect.element(button(PREVIOUS_LOOP)).toBeDisabled()
    await expect.element(button(NEXT_LOOP)).toBeEnabled()
  })

  it('disables both arrows when told to', async () => {
    setup({
      playheadMs: 10_000,
      loops: [row('a', 1000, 5000), row('b', 20_000, 25_000)],
      disabled: true,
    })
    await expect.element(button(PREVIOUS_LOOP)).toBeDisabled()
    await expect.element(button(NEXT_LOOP)).toBeDisabled()
  })
})
