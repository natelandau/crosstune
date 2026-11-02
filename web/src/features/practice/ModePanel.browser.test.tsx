import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { renderWithProviders } from '../../test/render'
import type { IsolateOutline } from '../player/isolate/isolateStage'
import { DEFAULT_ISOLATE } from '../player/isolate/isolateSetting'
import { ModeControls, type IsolateControls } from './ModeControls'
import { ModePanel } from './ModePanel'
import { ISOLATE_LABEL, LOOPS_LABEL, MODES_LABEL, MUTE, SEGMENT_LABEL } from './practiceCopy'
import { PITCH } from './PitchPanel'
import { SPEED } from './SpeedPanel'
import { PITCH_BADGE } from '../player/transportCopy'
import type { Mode } from './usePracticeMode'

const OUTLINE: IsolateOutline = {
  pan: new Float32Array(32).fill(0.5),
  freq: new Float32Array(48).fill(0.5),
}

function isolateControls(overrides: Partial<IsolateControls> = {}): IsolateControls {
  return {
    value: DEFAULT_ISOLATE,
    isMono: false,
    onChange: vi.fn(),
    subscribeOutline: vi.fn(() => () => {}),
    recordingId: 'r1',
    ...overrides,
  }
}

function panel(isolate: IsolateControls | null, mode: Mode = 'loops', { pitchCents = 0 } = {}) {
  return (
    <ModePanel
      mode={mode}
      onMode={vi.fn()}
      speedPercent={100}
      pitchCents={pitchCents}
      onSpeed={vi.fn()}
      onPitch={vi.fn()}
      stageUnavailable={false}
      isolate={isolate}
      loops={<p>Loops panel</p>}
    />
  )
}

it('leaves Isolate out where nothing can isolate, such as a streaming link', async () => {
  renderWithProviders(panel(null))
  const modes = page.getByRole('radiogroup', { name: MODES_LABEL })
  await expect.poll(() => modes.getByRole('radio').all().length).toBe(3)
  expect(modes.getByRole('radio', { name: new RegExp(`^${ISOLATE_LABEL}`) }).query()).toBeNull()
})

it('offers Isolate for a recording, naming its effect once it is off the default', async () => {
  const { rerender } = renderWithProviders(panel(isolateControls()))
  const modes = page.getByRole('radiogroup', { name: MODES_LABEL })
  await expect.poll(() => modes.getByRole('radio').all().length).toBe(4)
  await expect
    .element(modes.getByRole('radio', { name: ISOLATE_LABEL, exact: true }))
    .toBeInTheDocument()
  rerender(panel(isolateControls({ value: { ...DEFAULT_ISOLATE, effect: 'mute' } })))
  await expect
    .element(modes.getByRole('radio', { name: SEGMENT_LABEL(ISOLATE_LABEL, MUTE), exact: true }))
    .toBeInTheDocument()
})

function controls(mode: Mode, isolate: IsolateControls, loops = 'Loops panel') {
  return (
    <ModeControls
      mode={mode}
      speedPercent={100}
      pitchCents={0}
      onSpeed={vi.fn()}
      onPitch={vi.fn()}
      isolate={isolate}
      loops={<p>{loops}</p>}
    />
  )
}

const drawn = () => document.querySelectorAll('canvas[data-outline]').length

it('shows plain mode names once a changed value label no longer fits', async () => {
  // Wide enough for every name and a short value, too narrow for Isolate's value.
  const narrow = (effect: 'solo' | 'mute') => (
    <div style={{ width: 340 }}>
      {panel(isolateControls({ value: { ...DEFAULT_ISOLATE, effect } }), 'loops', {
        pitchCents: 100,
      })}
    </div>
  )
  const { rerender } = renderWithProviders(narrow('solo'))
  const shown = () =>
    [...document.querySelectorAll('[data-mode-selector] [role="radio"] span.relative')].map(
      (label) => label.textContent,
    )
  await expect
    .poll(shown)
    .toEqual([LOOPS_LABEL, SPEED, SEGMENT_LABEL(PITCH, PITCH_BADGE(100)), ISOLATE_LABEL])

  rerender(narrow('mute'))

  await expect
    .element(page.getByRole('radio', { name: SEGMENT_LABEL(ISOLATE_LABEL, MUTE), exact: true }))
    .toBeInTheDocument()
  await expect.poll(shown).toEqual([LOOPS_LABEL, SPEED, PITCH, ISOLATE_LABEL])
})

it('names no effect on a mono recording whose only change is pan', async () => {
  const value = { ...DEFAULT_ISOLATE, panStart: -50, panEnd: 0 }
  renderWithProviders(panel(isolateControls({ value, isMono: true })))
  const modes = page.getByRole('radiogroup', { name: MODES_LABEL })
  await expect
    .element(modes.getByRole('radio', { name: ISOLATE_LABEL, exact: true }))
    .toBeInTheDocument()
})

it('follows the outline only while Isolate shows, and drops it for another recording', async () => {
  let report: ((outline: IsolateOutline) => void) | null = null
  const unsubscribe = vi.fn()
  const subscribeOutline = vi.fn((fn: (outline: IsolateOutline) => void) => {
    report = fn
    return unsubscribe
  })
  const isolate = isolateControls({ subscribeOutline })
  const { rerender } = renderWithProviders(controls('loops', isolate))
  await expect.poll(() => document.querySelectorAll('canvas').length).toBe(2)
  expect(subscribeOutline).not.toHaveBeenCalled()

  rerender(controls('isolate', isolate))
  await expect.poll(() => subscribeOutline.mock.calls.length).toBe(1)
  report!(OUTLINE)
  await expect.poll(drawn).toBe(2)

  rerender(controls('isolate', { ...isolate, recordingId: 'r2' }))
  await expect.poll(drawn).toBe(0)

  await expect.poll(() => subscribeOutline.mock.calls.length).toBe(2)
  const subscribed = subscribeOutline.mock.calls.length
  const unsubscribed = unsubscribe.mock.calls.length
  rerender(controls('loops', { ...isolate, recordingId: 'r2' }))
  await expect.poll(() => unsubscribe.mock.calls.length).toBe(unsubscribed + 1)
  rerender(controls('loops', { ...isolate, recordingId: 'r3' }, 'Loops panel, r3'))
  await expect.element(page.getByText('Loops panel, r3')).toBeInTheDocument()
  // The commit has landed; its effects have run by the next frame.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(subscribeOutline).toHaveBeenCalledTimes(subscribed)
})
