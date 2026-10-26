import { render } from '@testing-library/react'
import { useMemo } from 'react'
import { describe, expect, it } from 'vitest'
import { BAR_STEP, BAR_WIDTH } from '../capture/waveformBars'
import { LaneBars } from './LaneBars'

const WIDTH_PX = 200
const HEIGHT_PX = 40
// Two and a half 20 ms points to each 5 px bar, so a bar laid from the view's edge rather than
// the recording's start would take different points.
const PX_PER_S = 100
const LENGTH_MS = 10_000

const values = Uint8Array.from({ length: 500 }, (_, i) => (i * 97) % 251)
const shown = { peaks: { pointsPerSecond: 50, values }, loudest: 250 }

function Harness({ startMs }: { startMs: number }) {
  const start = useMemo(() => ({ get: () => startMs, subscribe: () => () => {} }), [startMs])
  return (
    <div style={{ width: WIDTH_PX }}>
      <LaneBars
        shown={shown}
        startMs={start}
        pxPerS={PX_PER_S}
        lengthMs={LENGTH_MS}
        heightClass="h-10"
      />
    </div>
  )
}

/** The painted height, in device pixels, of the column at `x` CSS pixels. */
function columnHeight(x: number): number {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-bars]')!
  const scale = window.devicePixelRatio || 1
  const column = canvas
    .getContext('2d')!
    .getImageData(Math.floor(x * scale), 0, 1, Math.round(HEIGHT_PX * scale)).data
  let painted = 0
  for (let i = 3; i < column.length; i += 4) if (column[i]! > 0) painted++
  return painted
}

/** Each bar's painted height by its index, for the bars wholly inside the view. */
function heights(startMs: number): Map<number, number> {
  const offsetX = (startMs / 1000) * PX_PER_S
  const out = new Map<number, number>()
  for (
    let index = Math.ceil(offsetX / BAR_STEP);
    (index + 1) * BAR_STEP - offsetX < WIDTH_PX;
    index++
  ) {
    out.set(index, columnHeight(index * BAR_STEP - offsetX + BAR_WIDTH / 2))
  }
  return out
}

describe('LaneBars', () => {
  it('keeps each bar its height as the view scrolls', async () => {
    const view = render(<Harness startMs={1_000} />)
    await expect.poll(() => columnHeight(BAR_WIDTH / 2)).toBeGreaterThan(0)
    const before = heights(1_000)
    // 130 ms is 13 px, so the bars move without lining up on their old places: a bar now
    // starts 2 px in, where the old frame had a gap.
    view.rerender(<Harness startMs={1_130} />)
    await expect.poll(() => columnHeight(2 + BAR_WIDTH / 2)).toBeGreaterThan(0)
    const after = heights(1_130)
    const shared = [...after.keys()].filter((index) => before.has(index))
    expect(shared.length).toBeGreaterThan(20)
    for (const index of shared) expect(after.get(index)).toBe(before.get(index))
  })

  it('leaves the view blank before the recording starts', async () => {
    render(<Harness startMs={-500} />)
    // The recording starts 50 px in.
    await expect.poll(() => columnHeight(50 + BAR_WIDTH / 2)).toBeGreaterThan(0)
    expect(columnHeight(25)).toBe(0)
  })
})
