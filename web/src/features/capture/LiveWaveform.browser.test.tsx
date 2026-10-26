import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { LiveWaveform } from './LiveWaveform'

it('draws in the new palette after the scheme changes', async () => {
  const root = document.documentElement
  const before = root.dataset.scheme
  root.dataset.scheme = 'light'
  try {
    const analyser = {
      fftSize: 32,
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
    } as unknown as AnalyserNode
    const { container } = render(
      <LiveWaveform analyser={analyser} paused={false} active className="text-ink" />,
    )
    const canvas = container.querySelector('canvas')!
    const context = canvas.getContext('2d')!
    const light = getComputedStyle(canvas).color
    await expect.poll(() => context.fillStyle).not.toBe('#000000')
    const lightFill = context.fillStyle

    root.dataset.scheme = 'dark'
    await expect.poll(() => getComputedStyle(canvas).color).not.toBe(light)
    await expect.poll(() => context.fillStyle).not.toBe(lightFill)
  } finally {
    if (before === undefined) delete root.dataset.scheme
    else root.dataset.scheme = before
  }
})
