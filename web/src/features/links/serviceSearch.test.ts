import { describe, expect, it } from 'vitest'
import { IMPORTABLE_PROVIDERS, searchQuery } from './serviceSearch'

describe('IMPORTABLE_PROVIDERS', () => {
  it('names every recording origin but the user’s own', () => {
    expect(IMPORTABLE_PROVIDERS).toEqual(['slippery_hill'])
  })
})

describe('searchQuery', () => {
  it('trims the text', () => {
    expect(searchQuery('  Soldier’s Joy ')).toBe('Soldier’s Joy')
  })

  it('caps a long query at 200 code points without splitting an emoji', () => {
    const query = searchQuery(`${'a'.repeat(199)}🎻🎻`)
    expect(Array.from(query)).toHaveLength(200)
    expect(query.endsWith('🎻')).toBe(true)
  })
})
