import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { addLoop, removeLoop } from '../../commands/loops'
import { LOOP_LIMIT, NO_ROOM } from '../../commands/messages'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecordingLoop } from '../../db/types'
import { stampAxes } from '../../test/render'
import { openTestDb } from '../../test/db'
import { renderInPractice } from '../../test/practiceTheme'
import { captureRecording, liveLoops, seedLoop } from '../../test/recordings'
import { loopRow } from '../../test/rows'
import { LoopsPanel } from './LoopsPanel'
import {
  DELETE_LOOP,
  INSIDE_LOOP,
  LOOP_CREATED,
  LOOP_NAME_SUGGESTIONS,
  LOOP_NOT_SAVED,
  LOOPS_EMPTY_HINT,
  NEW_LOOP,
  NEXT_LOOP,
  PREVIOUS_LOOP,
} from './practiceCopy'
import type { LoopPlayback } from './useLoopPlayback'

vi.mock('../../commands/loops', { spy: true })

let db: CrosstuneDb
beforeEach(() => {
  db = openTestDb()
})
afterEach(async () => {
  vi.restoreAllMocks()
})

const BOUNDS = { startMs: 0, endMs: 60_000 }

function row(id: string, start_ms: number, end_ms: number, label: string | null = null) {
  return loopRow({ id, start_ms, end_ms, label })
}

function setup({
  loops = [],
  playheadMs = 30_000,
  selectedId = null,
  renamingId = null,
  bounds = BOUNDS,
  partStructure = null,
  onCommand,
}: {
  loops?: LocalRecordingLoop[]
  playheadMs?: number
  selectedId?: string | null
  renamingId?: string | null
  bounds?: { startMs: number; endMs: number }
  partStructure?: string | null
  onCommand?: () => number | void
} = {}) {
  const playback: LoopPlayback = { selectedId, select: vi.fn(), hold: vi.fn() }
  const handlers = {
    onCreated: vi.fn(),
    onError: vi.fn(),
    announce: vi.fn(),
  }
  const ui = (recordingId: string) => (
    <LoopsPanel
      recordingId={recordingId}
      loops={loops}
      playback={playback}
      playheadMs={playheadMs}
      bounds={bounds}
      renamingId={renamingId}
      partStructure={partStructure}
      onCommand={onCommand}
      {...handlers}
    />
  )
  return { playback, ui, ...handlers }
}

const button = (name: string) => page.getByRole('button', { name, exact: true })

/** The element `name`'s button points `aria-describedby` at. */
function describedBy(name: string): HTMLElement | null {
  const id = button(name).element().getAttribute('aria-describedby')
  return id ? document.getElementById(id) : null
}

/** Clipped to nothing on screen while a screen reader still reads it. */
async function expectHidden(element: HTMLElement) {
  await expect
    .poll(() => {
      const { width, height } = element.getBoundingClientRect()
      return width * height
    })
    .toBeLessThanOrEqual(1)
}

/** The color practice's danger resolves to. */
function dangerColor(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--panel-danger)'
  document.querySelector('[data-practice]')!.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

describe('LoopsPanel', () => {
  it('shows the empty hint with no loops', async () => {
    const t = setup()
    renderInPractice(t.ui('rec'), { db })
    await expect.element(page.getByText(LOOPS_EMPTY_HINT)).toBeVisible()
  })

  it('hides the hint once there is a loop', async () => {
    const t = setup({ loops: [row('a', 1000, 5000)] })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeVisible()
    await expect.element(page.getByText(LOOPS_EMPTY_HINT)).not.toBeVisible()
  })

  it('disables New loop inside a loop and tells assistive tech which, out of sight', async () => {
    const t = setup({ loops: [row('a', 20_000, 40_000, 'B part')] })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeDisabled()
    await expect.poll(() => describedBy(NEW_LOOP)?.textContent).toBe(INSIDE_LOOP('B part'))
    await expectHidden(describedBy(NEW_LOOP)!)
  })

  it('names an unnamed loop by its time', async () => {
    const t = setup({ loops: [row('a', 20_000, 40_000)] })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeDisabled()
    await expect.poll(() => describedBy(NEW_LOOP)?.textContent).toBe(INSIDE_LOOP('Loop 0:20'))
  })

  it('disables New loop with no room and tells assistive tech', async () => {
    const t = setup({
      playheadMs: 10_000,
      loops: [row('a', 0, 9_800), row('b', 10_200, 20_000)],
    })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeDisabled()
    await expect.poll(() => describedBy(NEW_LOOP)?.textContent).toBe(NO_ROOM)
    await expectHidden(describedBy(NEW_LOOP)!)
  })

  it('disables New loop at 100 loops and tells assistive tech', async () => {
    const loops = Array.from({ length: 100 }, (_, i) => row(`l${i}`, i * 1000, i * 1000 + 600))
    const t = setup({ loops, playheadMs: 150_000, bounds: { startMs: 0, endMs: 200_000 } })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeDisabled()
    await expect.poll(() => describedBy(NEW_LOOP)?.textContent).toBe(LOOP_LIMIT)
    await expectHidden(describedBy(NEW_LOOP)!)
  })

  it('creates a loop, selects it, and announces Loop created', async () => {
    const recordingId = await captureRecording(db, { durationMs: 60_000 })
    const t = setup()
    renderInPractice(t.ui(recordingId), { db })
    await button(NEW_LOOP).click()
    await expect.poll(() => t.onCreated.mock.calls.length).toBe(1)
    const [id] = await liveLoops(db, recordingId)
    expect(t.onCreated).toHaveBeenCalledWith(id!.id)
    expect(t.playback.select).toHaveBeenCalledWith(id!.id)
    expect(t.announce).toHaveBeenCalledWith(LOOP_CREATED)
    expect(id).toMatchObject({ start_ms: 26_000, end_ms: 34_000 })
  })

  it('places a new loop where onCommand says the playhead settled', async () => {
    const recordingId = await captureRecording(db, { durationMs: 60_000 })
    const onCommand = vi.fn(() => 40_000)
    const t = setup({ playheadMs: 30_000, onCommand })
    renderInPractice(t.ui(recordingId), { db })
    await button(NEW_LOOP).click()
    await expect.poll(() => t.onCreated.mock.calls.length).toBe(1)
    expect(onCommand).toHaveBeenCalledTimes(1)
    const [made] = await liveLoops(db, recordingId)
    expect(made).toMatchObject({ start_ms: 36_000, end_ms: 44_000 })
  })

  it('reports a failed create as not saved', async () => {
    vi.mocked(addLoop).mockRejectedValueOnce(new Error('disk full'))
    const t = setup()
    renderInPractice(t.ui('rec'), { db })
    await button(NEW_LOOP).click()
    await expect.poll(() => t.onError.mock.calls.length).toBe(1)
    expect(t.onError).toHaveBeenCalledWith(LOOP_NOT_SAVED)
  })

  it.each([NO_ROOM, LOOP_LIMIT])(
    'reports a create refused with %s in its own words',
    async (why) => {
      vi.mocked(addLoop).mockRejectedValueOnce(new Error(why))
      const t = setup()
      renderInPractice(t.ui('rec'), { db })
      await button(NEW_LOOP).click()
      await expect.poll(() => t.onError.mock.calls.length).toBe(1)
      expect(t.onError).toHaveBeenCalledWith(why)
    },
  )

  it('reports a failed delete as not saved', async () => {
    vi.mocked(removeLoop).mockRejectedValueOnce(new Error('disk full'))
    const t = setup({ loops: [row('a', 1000, 5000)], selectedId: 'a' })
    renderInPractice(t.ui('rec'), { db })
    await button(DELETE_LOOP).click()
    await expect.poll(() => t.onError.mock.calls.length).toBe(1)
    expect(t.onError).toHaveBeenCalledWith(LOOP_NOT_SAVED)
  })

  it('turns New loop off with no reason while there is no audio', async () => {
    const t = setup()
    renderInPractice(
      <LoopsPanel
        recordingId="rec"
        loops={[]}
        playback={t.playback}
        playheadMs={30_000}
        bounds={BOUNDS}
        renamingId={null}
        partStructure={null}
        canCreate={false}
        onCreated={t.onCreated}
        onError={t.onError}
        announce={t.announce}
      />,
      { db },
    )
    await expect.element(button(NEW_LOOP)).toBeDisabled()
    await expect.element(button(NEW_LOOP)).not.toHaveAttribute('aria-describedby')
    await expect.element(page.getByText(LOOPS_EMPTY_HINT)).not.toBeVisible()
  })

  it('removes the selected loop without an error', async () => {
    const recordingId = await captureRecording(db, { durationMs: 60_000 })
    const id = await seedLoop(db, recordingId, 1000, 5000)
    const t = setup({ loops: [row(id, 1000, 5000)], selectedId: id })
    renderInPractice(t.ui(recordingId), { db })
    await button(DELETE_LOOP).click()
    await expect.poll(async () => (await liveLoops(db, recordingId)).length).toBe(0)
    expect(t.onError).not.toHaveBeenCalled()
  })

  it('shows Delete loop disabled and not red with nothing selected', async () => {
    const t = setup({ loops: [row('a', 1000, 5000)] })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(DELETE_LOOP)).toBeDisabled()
    await expect
      .poll(() => getComputedStyle(button(DELETE_LOOP).element()).color)
      .not.toBe(dangerColor())
  })

  it('shows Delete loop enabled and red with a loop selected', async () => {
    const t = setup({ loops: [row('a', 1000, 5000)], selectedId: 'a' })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(DELETE_LOOP)).toBeEnabled()
    await expect
      .poll(() => getComputedStyle(button(DELETE_LOOP).element()).color)
      .toBe(dangerColor())
  })

  it('leaves stepping between loops to the switcher', async () => {
    const t = setup({
      playheadMs: 10_000,
      loops: [row('a', 1000, 5000), row('b', 20_000, 25_000)],
    })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeVisible()
    await expect.element(button(PREVIOUS_LOOP)).not.toBeInTheDocument()
    await expect.element(button(NEXT_LOOP)).not.toBeInTheDocument()
  })

  it('offers part suggestions while a rename is open', async () => {
    const t = setup({
      loops: [row('a', 1000, 5000)],
      renamingId: 'a',
      partStructure: 'AABB',
    })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(page.getByRole('group', { name: LOOP_NAME_SUGGESTIONS })).toBeVisible()
    await expect.element(button('A part')).toBeVisible()
    await expect.element(button('B part')).toBeVisible()
  })

  it('fades the suggestions at their end on touch while more remain', async () => {
    stampAxes({ density: 'touch' })
    const t = setup({ loops: [row('a', 1000, 5000)], renamingId: 'a', partStructure: 'ABCDEFGH' })
    renderInPractice(t.ui('rec'), { db })
    const group = page.getByRole('group', { name: LOOP_NAME_SUGGESTIONS })
    await expect.element(group).toBeVisible()
    await expect
      .poll(() => getComputedStyle(group.element()).maskImage)
      .toContain('linear-gradient')
  })

  it('draws the suggestions in the dark scheme in the light appearance', async () => {
    stampAxes({ density: 'touch', scheme: 'light' })
    const t = setup({ loops: [row('a', 1000, 5000)], renamingId: 'a', partStructure: 'AB' })
    renderInPractice(t.ui('rec'), { db })
    const chip = page.getByRole('button', { name: 'A part', exact: true })
    await expect.element(chip).toBeVisible()
    const probe = document.createElement('span')
    probe.style.background = 'var(--practice-fill)'
    probe.style.color = 'var(--panel-ink)'
    document.querySelector('[data-practice]')!.append(probe)
    const dark = getComputedStyle(probe)
    const paint = (style: CSSStyleDeclaration) => [style.backgroundColor, style.color]
    await expect.poll(() => paint(getComputedStyle(chip.element()))).toEqual(paint(dark))
    probe.remove()
  })

  it('keeps its height when a rename opens the suggestions', async () => {
    stampAxes({ density: 'pointer' })
    const resting = setup({ loops: [row('a', 1000, 5000)], partStructure: 'AB' })
    const renaming = setup({ loops: [row('a', 1000, 5000)], renamingId: 'a', partStructure: 'AB' })
    renderInPractice(
      <>
        <div data-testid="resting">{resting.ui('rec')}</div>
        <div data-testid="renaming">{renaming.ui('rec')}</div>
      </>,
      { db },
    )
    await expect.element(page.getByRole('button', { name: 'A part', exact: true })).toBeVisible()
    const height = (id: string) => page.getByTestId(id).element().getBoundingClientRect().height
    await expect.poll(() => height('renaming')).toBe(height('resting'))
  })

  it('offers no suggestions when no rename is open', async () => {
    const t = setup({ loops: [row('a', 1000, 5000)], partStructure: 'AABB' })
    renderInPractice(t.ui('rec'), { db })
    await expect.element(button(NEW_LOOP)).toBeVisible()
    await expect.poll(() => document.body.textContent).not.toContain('A part')
  })
})
