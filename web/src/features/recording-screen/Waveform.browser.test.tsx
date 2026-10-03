import { render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SEEK_LABEL, Waveform } from './Waveform'

function Harness({ onSeek, disabled }: { onSeek: (ms: number) => void; disabled?: boolean }) {
  const [position, setPosition] = useState(20_000)
  return (
    <div style={{ width: 300 }}>
      <Waveform
        peaks={null}
        disabled={disabled}
        lengthMs={60_000}
        positionMs={position}
        onSeek={(ms) => {
          setPosition(ms)
          onSeek(ms)
        }}
      />
    </div>
  )
}

describe('Waveform', () => {
  it('is a slider that reads the elapsed time', async () => {
    render(<Harness onSeek={vi.fn()} />)
    const slider = page.getByRole('slider', { name: SEEK_LABEL })
    await expect.element(slider).toHaveAttribute('aria-valuetext', '0:20')
    await expect.element(slider).toHaveAttribute('aria-valuemax', '60000')
  })

  it('stays out of the tab order and the accessibility tree when decorative', async () => {
    render(
      <div style={{ width: 300 }}>
        <Waveform peaks={null} lengthMs={60_000} positionMs={0} decorative onSeek={vi.fn()} />
      </div>,
    )
    expect(page.getByRole('slider').elements()).toHaveLength(0)
    const bars = document.querySelector<HTMLElement>('[role="slider"]')!
    expect(bars.tabIndex).toBe(-1)
    expect(bars.getAttribute('aria-hidden')).toBe('true')
  })

  it('seeks to where it is clicked', async () => {
    const onSeek = vi.fn()
    render(<Harness onSeek={onSeek} />)
    const slider = page.getByRole('slider', { name: SEEK_LABEL })
    const width = slider.element().getBoundingClientRect().width
    await slider.click({ position: { x: width * 0.75, y: 10 } })
    await expect.poll(() => onSeek).toHaveBeenCalled()
    const ms = onSeek.mock.lastCall![0] as number
    expect(ms).toBeGreaterThan(44_000)
    expect(ms).toBeLessThan(46_000)
  })

  it('skips 5 seconds with the arrow keys, clamped to the recording', async () => {
    const onSeek = vi.fn()
    render(<Harness onSeek={onSeek} />)
    const slider = page.getByRole('slider', { name: SEEK_LABEL })
    ;(slider.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => onSeek).toHaveBeenLastCalledWith(25_000)
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('{ArrowLeft}')
    await expect.poll(() => onSeek).toHaveBeenLastCalledWith(15_000)
    await userEvent.keyboard('{Home}')
    await expect.poll(() => onSeek).toHaveBeenLastCalledWith(0)
    await userEvent.keyboard('{ArrowLeft}')
    await expect.poll(() => onSeek).toHaveBeenLastCalledWith(0)
  })

  it('neither seeks nor offers to while there is no audio', async () => {
    const onSeek = vi.fn()
    render(<Harness onSeek={onSeek} disabled />)
    const slider = page.getByRole('slider', { name: SEEK_LABEL })
    await expect.element(slider).toHaveAttribute('aria-disabled', 'true')
    await slider.click({ force: true })
    ;(slider.element() as HTMLElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSeek).not.toHaveBeenCalled()
  })
})
