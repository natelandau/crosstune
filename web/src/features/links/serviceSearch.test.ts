import { describe, expect, it } from 'vitest'
import { IMPORTABLE_PROVIDERS } from './serviceSearch'

describe('IMPORTABLE_PROVIDERS', () => {
  it('names every recording origin but the user’s own', () => {
    expect(IMPORTABLE_PROVIDERS).toEqual(['slippery_hill'])
  })
})
