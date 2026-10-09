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

  it('every scan and waveform element carries ph-no-capture', async () => {
    render(<Harness onSeek={vi.fn()} />)
    await expect.element(page.getByRole('slider', { name: SEEK_LABEL })).toBeVisible()
    await expect.poll(() => document.querySelector('canvas.ph-no-capture')).not.toBeNull()
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

  it('repaints its bars when the color scheme switches', async () => {
    const style = document.createElement('style')
    style.textContent = ":root[data-scheme='dark'] { --wave-played: rgb(255, 0, 0); }"
    document.head.append(style)
    try {
      render(<Harness onSeek={vi.fn()} />)
      const canvas = document.querySelector('canvas')!
      // A pixel inside the played part, a third of the way along at 20 of 60 seconds.
      const played = () => {
        const scale = window.devicePixelRatio || 1
        const context = canvas.getContext('2d')!
        const x = Math.floor(10 * scale)
        const y = Math.floor((canvas.clientHeight / 2) * scale)
        const [red, , , alpha] = context.getImageData(x, y, 1, 1).data
        return { red, painted: alpha! > 0 }
      }
      await expect.poll(() => played().painted).toBe(true)
      expect(played().red).not.toBe(255)
      document.documentElement.dataset.scheme = 'dark'
      await expect.poll(played).toEqual({ red: 255, painted: true })
    } finally {
      delete document.documentElement.dataset.scheme
      style.remove()
    }
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
