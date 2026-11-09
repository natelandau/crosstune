import { frameData, MotionConfig, MotionGlobalConfig, processFrame } from 'motion/react'
import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, onTestFinished, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { InRow } from './inRow'
import { SegmentedChoice } from './SegmentedChoice'

type Id = 'a' | 'b' | 'c'

const SEGMENTS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
] as const

function Harness({
  fill,
  width = 600,
  start = 'a',
  onChange,
}: {
  fill?: boolean
  width?: number
  start?: Id | null
  onChange?: (next: Id) => void
}) {
  const [selected, setSelected] = useState<Id | null>(start)
  return (
    <div style={{ width }}>
      <SegmentedChoice
        label="Letters"
        segments={SEGMENTS}
        selected={selected}
        onChange={(next) => {
          setSelected(next)
          onChange?.(next)
        }}
        fill={fill}
      />
    </div>
  )
}

const group = () => page.getByRole('radiogroup', { name: 'Letters' })
const option = (name: string) => group().getByRole('radio', { name, exact: true })
const pill = () => group().element().querySelector<HTMLElement>('[data-segment-pill]')

/**
 * Moves Motion's clock on by `ms`, a 16ms frame at a time. Motion runs its own frame loop, which
 * fake timers cannot reach, so the test holds its clock with manual timing and runs each frame.
 */
function frames(ms: number) {
  for (let t = 0; t < ms; t += 16) processFrame(frameData.timestamp + Math.min(16, ms - t))
}

function manualTiming() {
  MotionGlobalConfig.useManualTiming = true
  onTestFinished(() => void (MotionGlobalConfig.useManualTiming = false))
}

/** The pill's box once Motion has run a second of frames, long past the spring's end. */
const settledPill = () => {
  frames(1000)
  const rect = pill()!.getBoundingClientRect()
  return { x: Math.round(rect.x), width: Math.round(rect.width) }
}

const box = (name: string) => {
  const rect = option(name).element().getBoundingClientRect()
  return { x: Math.round(rect.x), width: Math.round(rect.width) }
}

it('slides the pill to the new option', async () => {
  manualTiming()
  renderWithProviders(<Harness />)
  await expect.element(option('Alpha')).toBeChecked()
  const before = pill()
  expect(before).not.toBeNull()
  await option('Gamma').click()
  await expect.element(option('Gamma')).toBeChecked()
  await expect.poll(() => pill()).toBe(before)
  await expect.poll(settledPill).toEqual(box('Gamma'))
})

it('moves the pill without sliding under reduced motion', async () => {
  renderWithProviders(
    <MotionConfig reducedMotion="always">
      <Harness />
    </MotionConfig>,
  )
  await expect.element(option('Alpha')).toBeChecked()
  const pillBox = () => {
    const rect = pill()?.getBoundingClientRect()
    return { x: rect?.x ?? NaN, width: rect?.width ?? NaN }
  }
  // The pill sits inside the track's padding, so it lines up with a segment to the pixel.
  const near = (a: { x: number; width: number }, b: { x: number; width: number }) =>
    Math.abs(a.x - b.x) <= 1 && Math.abs(a.width - b.width) <= 1
  await expect.poll(() => near(pillBox(), box('Alpha'))).toBe(true)
  const start = pillBox()
  const end = box('Beta')
  expect(Math.abs(end.width - start.width)).toBeGreaterThan(2)
  const seen: { x: number; width: number }[] = []
  const observer = new MutationObserver(() => seen.push(pillBox()))
  observer.observe(pill()!, { attributes: true, attributeFilter: ['style'] })
  onTestFinished(() => observer.disconnect())
  await option('Beta').click()
  await expect.poll(() => near(pillBox(), end)).toBe(true)
  expect(seen.filter((at) => !near(at, start) && !near(at, end))).toEqual([])
})

it('draws no pill while nothing is chosen, and chooses on a press', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness start={null} onChange={onChange} />)
  await expect.element(group()).toBeVisible()
  for (const { label } of SEGMENTS) await expect.element(option(label)).not.toBeChecked()
  expect(pill()).toBeNull()
  await option('Beta').click()
  await expect.element(option('Beta')).toBeChecked()
  await expect.poll(() => pill()).not.toBeNull()
  expect(onChange.mock.calls).toEqual([['b']])
})

it('keeps the pill under the choice when the track resizes', async () => {
  manualTiming()
  const { rerender } = renderWithProviders(<Harness fill start="b" />)
  await expect.element(option('Beta')).toBeChecked()
  await expect.poll(settledPill).toEqual(box('Beta'))
  rerender(<Harness fill start="b" width={300} />)
  await expect.poll(() => box('Beta').width).toBeLessThan(150)
  await expect.poll(settledPill).toEqual(box('Beta'))
})

it('sends one change for a click while another segment has focus', async () => {
  const onChange = vi.fn()
  renderWithProviders(<Harness onChange={onChange} />)
  await option('Alpha').click()
  await expect.element(option('Alpha')).toHaveFocus()
  await option('Gamma').click()
  await expect.element(option('Gamma')).toBeChecked()
  await expect.poll(() => onChange.mock.calls).toEqual([['c']])
})

it('sends one change for a click when the parent has not rendered it yet', async () => {
  const onChange = vi.fn()
  renderWithProviders(
    <SegmentedChoice label="Letters" segments={SEGMENTS} selected="a" onChange={onChange} />,
  )
  await option('Alpha').click()
  await expect.element(option('Alpha')).toHaveFocus()
  await option('Gamma').click()
  await expect.poll(() => onChange.mock.calls.length).toBeGreaterThan(0)
  await expect.element(option('Gamma')).toHaveFocus()
  expect(onChange.mock.calls).toEqual([['c']])
})

it('is compact in a row', async () => {
  const height = (value: string) => {
    const probe = document.createElement('div')
    probe.style.height = `var(${value})`
    document.body.append(probe)
    const result = probe.getBoundingClientRect().height
    probe.remove()
    return result
  }
  renderWithProviders(
    <>
      <InRow.Provider value>
        <div data-testid="row">
          <SegmentedChoice label="Letters" segments={SEGMENTS} selected="a" onChange={() => {}} />
        </div>
      </InRow.Provider>
      <div data-testid="plain">
        <SegmentedChoice label="Other" segments={SEGMENTS} selected="a" onChange={() => {}} />
      </div>
    </>,
  )
  const track = (id: string) =>
    page.getByTestId(id).element().firstElementChild!.getBoundingClientRect().height
  await expect.poll(() => track('row')).toBe(height('--size-compact'))
  await expect.poll(() => track('plain')).toBe(height('--size-regular'))
})

it('moves the selection with arrow keys', async () => {
  renderWithProviders(<Harness />)
  await option('Alpha').click()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(option('Beta')).toBeChecked()
  await expect.element(option('Beta')).toHaveFocus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(option('Gamma')).toBeChecked()
  await userEvent.keyboard('{ArrowLeft}')
  await expect.element(option('Beta')).toBeChecked()
})

it('spans the row when fill is set', async () => {
  const { rerender } = renderWithProviders(<Harness />)
  const width = () => group().element().getBoundingClientRect().width
  await expect.poll(width).toBeLessThan(400)
  rerender(<Harness fill />)
  await expect.poll(width).toBe(600)
  const widths = () => SEGMENTS.map((s) => option(s.label).element().getBoundingClientRect().width)
  await expect.poll(() => new Set(widths().map(Math.round)).size).toBe(1)
})
