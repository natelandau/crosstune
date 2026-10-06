import { describe, expect, it } from 'vitest'
import { CRF_MAX, TARGET_BYTES, nextCrf } from '../../capture/encode.ts'

describe('nextCrf', () => {
  it('stops once the clip fits the budget', () => {
    expect(nextCrf(TARGET_BYTES, 28, 'tunes.mp4')).toBeNull()
  })

  it('raises the CRF while the clip is over budget, up to the highest', () => {
    expect(nextCrf(TARGET_BYTES + 1, 28, 'tunes.mp4')).toBe(31)
    expect(nextCrf(TARGET_BYTES + 1, CRF_MAX - 1, 'tunes.mp4')).toBe(CRF_MAX)
  })

  it('throws naming the clip when even the highest CRF is over budget', () => {
    expect(() => nextCrf(TARGET_BYTES + 1, CRF_MAX, 'tunes.mp4')).toThrow(
      /tunes\.mp4 is \d+ KB at crf 40, over the 800 KB budget/,
    )
  })
})
