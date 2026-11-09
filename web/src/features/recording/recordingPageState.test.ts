import { describe, expect, it } from 'vitest'
import { entryOf, reportedEntry } from './recordingPageState'

describe('entryOf', () => {
  it('is empty for an address reached without an open', () => {
    expect(entryOf(null)).toEqual({})
    expect(entryOf({ other: true })).toEqual({})
  })

  it('reads the open an opener asked for', () => {
    expect(
      entryOf({ recordingPage: { id: 'o1', from: '/tunes/t1', source: 'list', tab: 'practice' } }),
    ).toEqual({ id: 'o1', from: '/tunes/t1', source: 'list', tab: 'practice' })
  })

  it('drops what it does not know', () => {
    expect(entryOf({ recordingPage: { id: 7, source: 'elsewhere', tab: 'details' } })).toEqual({})
  })

  it('keeps who opened a reported entry and from where, and drops its source and tab', () => {
    const reported = reportedEntry({
      id: 'o1',
      from: '/tunes/t1',
      source: 'list',
      tab: 'practice',
    })
    expect(entryOf(reported)).toEqual({ id: 'o1', from: '/tunes/t1', reported: true })
    expect(entryOf({ recordingPage: { reported: true, source: 'list', tab: 'practice' } })).toEqual(
      { reported: true },
    )
  })
})
