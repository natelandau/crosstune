import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { addLoop, removeLoop, restoreLoop, updateLoop } from '../../commands/loops'
import { LOOP_LIMIT } from '../../commands/messages'
import { createTune } from '../../commands/tunes'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalRecording } from '../../db/types'
import { openTestDb } from '../../test/db'
import { modal, presentedModal } from '../../test/dialogs'
import { renderIonic } from '../../test/ionic'
import { fakePlaybackEngine, FakeAudioElement } from '../../test/providers'
import { captureRecording, liveLoops, seedLoop } from '../../test/recordings'
import { loopRow } from '../../test/rows'
import { useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { LOOP_START } from './LoopHandle'
import { LOOP_DELETED, LOOP_RANGE, NEW_LOOP, REPEATING } from './LoopList'
import { LOOP_HINT } from './LoopLane'
import { FIT, LOOP_NOT_SAVED } from './PracticeLanes'
import { LOCKED_LOOPS_NOTICE } from './PracticeView'
import { LOOP_NAME, LOOPS_LABEL, MARK_LOOP, PRACTICE } from './practiceCopy'

vi.mock('../../commands/loops', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

afterEach(async () => {
  document.documentElement.classList.remove('ios')
  await db.delete()
})

const LENGTH_MS = 180_000

/** A three-minute recording captured on this device, filed under a tune when one is given. */
function localRecording(
  extra: Partial<LocalRecording> = {},
  { tuneId = null, durationMs = LENGTH_MS }: { tuneId?: string | null; durationMs?: number } = {},
) {
  return captureRecording(db, { tuneId, durationMs, label: 'Jam recording', ...extra })
}

async function tuneWithParts(partStructure: string | null) {
  const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
  await db.tunes.update(tuneId, { part_structure: partStructure })
  return tuneId
}

const lane = () => document.querySelector<HTMLElement>('[data-loop-lane]')
const list = () => document.querySelector<HTMLElement>('[data-practice-loops]')
const rowButtons = () =>
  Array.from(list()?.querySelectorAll<HTMLButtonElement>('[data-row-open]') ?? [])
/** A row's text: its open control is named by the row's content rather than holding it. */
const rowText = (button: HTMLElement) =>
  (button.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
const rowFor = (text: string) => rowButtons().find((b) => rowText(b).includes(text)) ?? null
const newLoopButton = () =>
  Array.from(list()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
    (b) => b.textContent === NEW_LOOP,
  ) ?? null
const nameField = () => list()?.querySelector<HTMLInputElement>(`input[aria-label="${LOOP_NAME}"]`)
// The tune's parts load in a live query that can resolve after the name field renders.
const partChips = () =>
  Array.from(list()?.querySelectorAll<HTMLButtonElement>('[role="group"] button') ?? [])

/** Practice opened straight on the recording and paused, with its lanes measured. */
async function openPractice(id: string, lengthMs = LENGTH_MS, trimStartMs = 0) {
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  function Opener() {
    const { open } = useRecordingScreen()
    return (
      <button type="button" onClick={() => open(id, 'practice')}>
        Open in Practice
      </button>
    )
  }
  renderIonic(<Opener />, { db, playbackEngine: engine, recordingScreen: true, dock: true })
  await page.getByRole('button', { name: 'Open in Practice' }).click()
  await expect.element((await modal()).getByRole('heading', { name: PRACTICE })).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBe(lengthMs)
  engine.pause()
  const seeded = (await liveLoops(db, id)).length
  await expect.poll(() => rowButtons().length).toBe(seeded)
  /** Plays on to `ms` on the trimmed timeline, the way the element does. */
  const playTo = async (ms: number) => {
    element.currentTime = (ms + trimStartMs) / 1000
    await expect.poll(() => engine.getState().positionMs).toBe(ms)
  }
  return { engine, playTo }
}

/** A key pressed with focus on nothing in particular. */
function press(key: string, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

/** Tabs forward until `match` holds focus, as a keyboard-only musician would reach it. */
async function tabTo(match: () => Element | null) {
  for (let i = 0; i < 80; i++) {
    const target = match()
    if (target && document.activeElement === target) return
    await userEvent.tab()
  }
  throw new Error('never reached by Tab')
}

describe('LoopList', () => {
  it('lists each loop with its color, name, range, and length on the trimmed timeline', async () => {
    const id = await localRecording({ trim_start_ms: 10_000 })
    const named = await seedLoop(db, id, 68_000, 121_000, { label: 'B part', color: 3 })
    await seedLoop(db, id, 20_000, 30_000)
    await openPractice(id, LENGTH_MS - 10_000)

    await expect.poll(() => rowButtons().length).toBe(2)
    // Timeline order: the unlabeled loop at 0:10 comes first and is named for its start.
    expect(rowText(rowButtons()[0]!)).toContain('Loop 0:10')
    expect(rowText(rowButtons()[0]!)).toContain(LOOP_RANGE(10_000, 20_000))
    const row = rowFor('B part')!
    expect(rowText(row)).toContain('0:58 – 1:51')
    expect(rowText(row)).toContain('0:53')
    const dot = list()!.querySelector<HTMLElement>(`.loop-color[data-loop-dot="${named}"]`)
    expect(dot?.dataset.color).toBe('3')
    expect(row.getAttribute('aria-current')).toBeNull()
    expect(rowText(row)).not.toContain(REPEATING)
  })

  it('marks the selected row, and says Repeating while Repeat is on', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    const { engine } = await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => rowFor('B part')?.getAttribute('aria-current')).toBe('true')
    expect(rowText(rowFor('B part')!)).not.toContain(REPEATING)
    press('r')
    await expect.poll(() => engine.getState().repeat).toBe(true)
    await expect.poll(() => rowText(rowFor('B part')!)).toContain(REPEATING)
  })

  it('selects a row from the keyboard alone, fits the view to it, and reaches its handles', async () => {
    const id = await localRecording()
    const loop = await seedLoop(db, id, 100_000, 120_000, { label: 'B part' })
    const { engine } = await openPractice(id)
    await expect.poll(() => lane()?.dataset.pxPerS).toBeTruthy()

    await tabTo(() => rowFor('B part'))
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)
    // Fit frames the loop with a tenth of its length as margin on either side.
    await expect.poll(() => Number(lane()!.dataset.startMs)).toBeCloseTo(98_000, 0)
    // Selecting does not open the name field.
    expect(nameField()).toBeFalsy()
    await expect
      .element((await modal()).getByRole('slider', { name: LOOP_START }))
      .toBeInTheDocument()
  })

  it('opens a name field with part chips on a tap of the selected row, and Enter saves once', async () => {
    const tuneId = await tuneWithParts('AABB')
    const id = await localRecording({}, { tuneId })
    await seedLoop(db, id, 10_000, 20_000, { label: 'A part' })
    const loop = await seedLoop(db, id, 60_000, 80_000)
    await openPractice(id)

    rowFor('Loop 1:00')!.click()
    await expect.poll(() => rowFor('Loop 1:00')?.getAttribute('aria-current')).toBe('true')
    rowFor('Loop 1:00')!.click()
    await expect.poll(nameField).toBeTruthy()
    expect(nameField()!.maxLength).toBe(100)
    expect(document.activeElement).toBe(nameField())
    // A part is already a label here, so it comes last.
    await expect.poll(() => partChips().map((b) => b.textContent)).toEqual(['B part', 'A part'])

    await userEvent.fill(nameField()!, 'Turnaround')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]!.slice(1)).toEqual([loop, { label: 'Turnaround' }])
    await expect.poll(nameField).toBeFalsy()
    await expect.poll(() => rowFor('Turnaround')).not.toBeNull()
    await expect.poll(() => document.activeElement).toBe(rowFor('Turnaround'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(vi.mocked(updateLoop)).toHaveBeenCalledTimes(1)
  })

  it('renames the selected loop on Enter, and a chip fills and saves the name', async () => {
    const tuneId = await tuneWithParts('AABB')
    const id = await localRecording({}, { tuneId })
    const loop = await seedLoop(db, id, 60_000, 80_000)
    const { engine } = await openPractice(id)
    rowFor('Loop 1:00')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(loop)

    press('Enter')
    await expect.poll(nameField).toBeTruthy()
    await expect.poll(() => partChips().find((b) => b.textContent === 'B part')).toBeTruthy()
    partChips()
      .find((b) => b.textContent === 'B part')!
      .click()
    await expect.poll(() => vi.mocked(updateLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(updateLoop).mock.calls[0]!.slice(1)).toEqual([loop, { label: 'B part' }])
    await expect.poll(() => rowFor('B part')).not.toBeNull()
  })

  it('cancels a rename with Escape and stays in Practice', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => rowFor('B part')?.getAttribute('aria-current')).toBe('true')
    rowFor('B part')!.click()
    await expect.poll(nameField).toBeTruthy()
    await userEvent.fill(nameField()!, 'Something else')
    await userEvent.keyboard('{Escape}')
    await expect.poll(nameField).toBeFalsy()
    expect(vi.mocked(updateLoop)).not.toHaveBeenCalled()
    await expect.element((await modal()).getByRole('heading', { name: PRACTICE })).toBeVisible()
    // Focus goes back to the row the field stood in for.
    await expect.poll(() => document.activeElement).toBe(rowFor('B part'))
  })

  it('saves and closes the field when focus leaves it through a chip', async () => {
    const tuneId = await tuneWithParts('AB')
    const id = await localRecording({}, { tuneId })
    const loop = await seedLoop(db, id, 60_000, 80_000)
    await openPractice(id)
    rowFor('Loop 1:00')!.click()
    await expect.poll(() => rowFor('Loop 1:00')?.getAttribute('aria-current')).toBe('true')
    rowFor('Loop 1:00')!.click()
    await expect.poll(nameField).toBeTruthy()
    await userEvent.fill(nameField()!, 'Turnaround')
    await expect.poll(() => partChips().length).toBeGreaterThan(0)
    await userEvent.tab()
    expect(document.activeElement).toBe(partChips()[0])
    await userEvent.tab()
    await userEvent.tab()
    await expect.poll(nameField).toBeFalsy()
    await expect.poll(async () => (await db.recording_loops.get(loop))?.label).toBe('Turnaround')
    expect(vi.mocked(updateLoop)).toHaveBeenCalledTimes(1)
  })

  it('never writes an untouched name over one another device saved meanwhile', async () => {
    const id = await localRecording()
    const loop = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => rowFor('B part')?.getAttribute('aria-current')).toBe('true')
    rowFor('B part')!.click()
    await expect.poll(nameField).toBeTruthy()
    await db.recording_loops.update(loop, { label: 'Turnaround' })
    nameField()!.focus()
    await userEvent.keyboard('{Enter}')
    await expect.poll(nameField).toBeFalsy()
    expect(vi.mocked(updateLoop)).not.toHaveBeenCalled()
    expect((await db.recording_loops.get(loop))?.label).toBe('Turnaround')
  })

  it('stores a blank name as null, shown by its start time', async () => {
    const id = await localRecording()
    const loop = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => rowFor('B part')?.getAttribute('aria-current')).toBe('true')
    rowFor('B part')!.click()
    await expect.poll(nameField).toBeTruthy()
    expect(nameField()!.value).toBe('B part')
    await userEvent.fill(nameField()!, '   ')
    await userEvent.keyboard('{Enter}')
    await expect.poll(async () => (await db.recording_loops.get(loop))?.label).toBeNull()
    await expect.poll(() => rowFor('Loop 1:00')).not.toBeNull()
  })

  it('deletes a loop from its row action, and Undo brings it back', async () => {
    const id = await localRecording()
    const loop = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await openPractice(id)
    await page.getByRole('button', { name: 'Delete B part' }).click()
    await expect.poll(() => vi.mocked(removeLoop).mock.calls.length).toBe(1)
    await expect.poll(() => rowFor('B part')).toBeNull()
    // The row's place in the tab order passes to what follows it.
    await expect.poll(() => document.activeElement).toBe(newLoopButton())
    await expect.element(page.getByText(LOOP_DELETED)).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => vi.mocked(restoreLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(restoreLoop).mock.calls[0]![1]).toBe(loop)
    await expect.poll(() => rowFor('B part')).not.toBeNull()
  })

  it('deletes the selected loop with Delete or Backspace, clearing Repeat, and Undo reselects it', async () => {
    const id = await localRecording()
    const first = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    const second = await seedLoop(db, id, 100_000, 120_000, { label: 'C part' })
    const { engine } = await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(first)
    press('r')
    await expect.poll(() => engine.getState().repeat).toBe(true)

    press('Delete')
    await expect.poll(async () => (await liveLoops(db, id)).map((l) => l.id)).toEqual([second])
    await expect.poll(() => engine.getState().loop).toBeNull()
    expect(engine.getState().repeat).toBe(false)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => engine.getState().loop?.id).toBe(first)

    rowFor('C part')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(second)
    press('Backspace')
    await expect.poll(async () => (await liveLoops(db, id)).map((l) => l.id)).toEqual([first])
  })

  it('moves focus from a handle to the next row when Delete removes its loop', async () => {
    const id = await localRecording()
    const first = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await seedLoop(db, id, 100_000, 120_000, { label: 'C part' })
    const { engine } = await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(first)
    const handle = (await modal()).getByRole('slider', { name: LOOP_START })
    await expect.element(handle).toBeInTheDocument()
    ;(handle.element() as HTMLElement).focus()
    await userEvent.keyboard('{Delete}')
    await expect.poll(() => rowFor('B part')).toBeNull()
    await expect.poll(() => document.activeElement).toBe(rowFor('C part'))
  })

  it('leaves focus where the musician moved it while a delete lands', async () => {
    const id = await localRecording()
    const first = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await seedLoop(db, id, 100_000, 120_000, { label: 'C part' })
    const { engine } = await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(first)
    rowFor('B part')!.focus()
    press('Delete')
    const fit = Array.from(presentedModal()!.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent === FIT,
    )!
    fit.focus()
    await expect.poll(() => rowFor('B part')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.activeElement).toBe(fit)
  })

  it('keeps focus on a row whose delete was refused', async () => {
    const id = await localRecording()
    const first = await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await seedLoop(db, id, 100_000, 120_000, { label: 'C part' })
    const { engine } = await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => engine.getState().loop?.id).toBe(first)
    vi.mocked(removeLoop).mockRejectedValueOnce(new Error('disk full'))
    const row = rowFor('B part')!
    row.focus()
    press('Delete')
    await expect.element((await modal()).getByText(LOOP_NOT_SAVED)).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.activeElement).toBe(row)
  })

  it('leaves a loop alone when Delete lands in the name field', async () => {
    const id = await localRecording()
    await seedLoop(db, id, 60_000, 80_000, { label: 'B part' })
    await openPractice(id)
    rowFor('B part')!.click()
    await expect.poll(() => rowFor('B part')?.getAttribute('aria-current')).toBe('true')
    rowFor('B part')!.click()
    await expect.poll(nameField).toBeTruthy()
    press('Backspace', nameField()!)
    press('Delete', nameField()!)
    expect(vi.mocked(removeLoop)).not.toHaveBeenCalled()
  })

  it('makes a four second loop at the playhead with New loop and selects it', async () => {
    const id = await localRecording({ trim_start_ms: 2_000 })
    const { engine, playTo } = await openPractice(id, LENGTH_MS - 2_000, 2_000)
    await playTo(30_000)
    newLoopButton()!.click()
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2]).toEqual({ start_ms: 32_000, end_ms: 36_000 })
    const [created] = await liveLoops(db, id)
    await expect.poll(() => engine.getState().loop?.id).toBe(created!.id)
    expect(engine.getState().repeat).toBe(false)
  })

  it('holds a New loop near the end inside the trim range', async () => {
    const id = await localRecording()
    const { playTo } = await openPractice(id)
    await playTo(LENGTH_MS - 1_000)
    newLoopButton()!.click()
    await expect.poll(() => vi.mocked(addLoop).mock.calls.length).toBe(1)
    expect(vi.mocked(addLoop).mock.calls[0]![2]).toEqual({
      start_ms: LENGTH_MS - 1_000,
      end_ms: LENGTH_MS,
    })
  })

  it('disables New loop at the cap with the reason', async () => {
    const id = await localRecording()
    await db.recording_loops.bulkPut(
      Array.from({ length: 100 }, (_, i) =>
        loopRow({ id: newId(), recording_id: id, start_ms: i * 1_000, end_ms: i * 1_000 + 900 }),
      ),
    )
    await openPractice(id)
    await expect.poll(() => rowButtons().length).toBe(100)
    expect(newLoopButton()!.disabled).toBe(true)
    expect(newLoopButton()!.title).toBe(LOOP_LIMIT)
    newLoopButton()!.click()
    expect(vi.mocked(addLoop)).not.toHaveBeenCalled()
  })

  it('hides New loop and A B on a recording trimmed shorter than a loop', async () => {
    const id = await localRecording({ trim_start_ms: 1_000, trim_end_ms: 1_400 })
    await openPractice(id, 400)
    await expect.poll(list).not.toBeNull()
    expect(newLoopButton()).toBeNull()
    expect(document.querySelector(`button[aria-label="${MARK_LOOP}"]`)).toBeNull()
    // Nothing can be drawn there either, so the lane offers no hint to draw.
    await expect.poll(lane).not.toBeNull()
    expect(lane()!.textContent).not.toContain(LOOP_HINT)
  })

  it('names the list region', async () => {
    const id = await localRecording()
    await openPractice(id)
    await expect
      .element((await modal()).getByRole('region', { name: LOOPS_LABEL }))
      .toBeInTheDocument()
  })

  it('says loops repeat only while the screen is on, on iOS alone', async () => {
    const id = await localRecording()
    await openPractice(id)
    expect(document.body.textContent).not.toContain(LOCKED_LOOPS_NOTICE)
  })

  it('shows the locked-screen notice on iOS', async () => {
    document.documentElement.classList.add('ios')
    const id = await localRecording()
    await openPractice(id)
    await expect.element(page.getByText(LOCKED_LOOPS_NOTICE)).toBeInTheDocument()
  })
})
