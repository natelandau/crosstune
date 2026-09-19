import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'

describe('contrastRatio', () => {
  it('reads the two ends of the scale', () => {
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 5)
    expect(contrastRatio('rgb(120, 120, 120)', 'rgb(120, 120, 120)')).toBeCloseTo(1, 5)
  })

  it('composites a translucent foreground over what it sits on', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', 'rgb(255, 255, 255)')).toBeCloseTo(
      contrastRatio('rgb(128, 128, 128)', 'rgb(255, 255, 255)'),
      1,
    )
  })

  it('refuses a color it cannot read rather than answering with a number', () => {
    // A stylesheet may hand back any color syntax, and digits pulled out of oklch() would
    // measure as a ratio that happens to pass.
    expect(() => contrastRatio('oklch(0.72 0.11 200)', 'rgb(255, 255, 255)')).toThrow(/not an rgb/)
    expect(() => contrastRatio('color(srgb 0.2 0.3 0.4)', 'rgb(255, 255, 255)')).toThrow()
    expect(() => contrastRatio('rgb(50% 50% 50%)', 'rgb(255, 255, 255)')).toThrow()
    expect(() => contrastRatio('rebeccapurple', 'rgb(255, 255, 255)')).toThrow()
  })
})
