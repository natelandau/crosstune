import { render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useElementSize } from './useElementSize'

function Measured({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  return <div ref={ref} style={{ width, height }} data-size={`${size.width}x${size.height}`} />
}

const measured = (container: HTMLElement) =>
  container.querySelector('[data-size]')?.getAttribute('data-size')

describe('useElementSize', () => {
  it('measures the element and follows it as it resizes', async () => {
    const { container, rerender } = render(<Measured width={300} height={120} />)
    await expect.poll(() => measured(container)).toBe('300x120')
    rerender(<Measured width={180} height={90} />)
    await expect.poll(() => measured(container)).toBe('180x90')
  })
})
