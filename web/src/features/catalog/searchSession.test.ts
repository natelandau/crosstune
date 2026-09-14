import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSearchQuery, readSearchQuery, writeSearchQuery } from './searchSession'

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('searchSession', () => {
  it('reads back the written query', () => {
    expect(readSearchQuery()).toBe('')
    writeSearchQuery('soldier')
    expect(readSearchQuery()).toBe('soldier')
  })

  it('clears the query', () => {
    writeSearchQuery('soldier')
    clearSearchQuery()
    expect(readSearchQuery()).toBe('')
    expect(sessionStorage.length).toBe(0)
  })

  it('treats blocked storage as an empty search', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeSearchQuery('soldier')).not.toThrow()
    expect(readSearchQuery()).toBe('')
  })
})
