import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSearchQueries, readSearchQuery, writeSearchQuery } from './searchSession'

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('searchSession', () => {
  it('reads back the written query', () => {
    expect(readSearchQuery('catalog')).toBe('')
    writeSearchQuery('catalog', 'soldier')
    expect(readSearchQuery('catalog')).toBe('soldier')
  })

  it('keeps each screen its own query', () => {
    writeSearchQuery('catalog', 'soldier')
    writeSearchQuery('recordings', 'jig')
    expect(readSearchQuery('catalog')).toBe('soldier')
    expect(readSearchQuery('recordings')).toBe('jig')
  })

  it('removes the entry when the query is emptied', () => {
    writeSearchQuery('recordings', 'jig')
    writeSearchQuery('recordings', '')
    expect(readSearchQuery('recordings')).toBe('')
    expect(sessionStorage.length).toBe(0)
  })

  it('clears every screen', () => {
    writeSearchQuery('catalog', 'soldier')
    writeSearchQuery('recordings', 'jig')
    clearSearchQueries()
    expect(readSearchQuery('catalog')).toBe('')
    expect(readSearchQuery('recordings')).toBe('')
    expect(sessionStorage.length).toBe(0)
  })

  it('treats blocked storage as an empty search', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeSearchQuery('catalog', 'soldier')).not.toThrow()
    expect(readSearchQuery('catalog')).toBe('')
  })
})
