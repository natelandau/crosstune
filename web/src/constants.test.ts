import { describe, expect, it } from 'vitest'
import { FEELS } from './constants'

describe('FEELS', () => {
  it('offers Song, the feel stored rows carry for a piece with words', () => {
    expect(FEELS).toContain('Song')
  })
})
