import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveWaveform } from './LiveWaveform'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LiveWaveform', () => {
  it('renders under reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const analyser = { fftSize: 32, getByteTimeDomainData: vi.fn() } as unknown as AnalyserNode
    const { container } = render(<LiveWaveform analyser={analyser} paused={false} active />)
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true')
  })
})
