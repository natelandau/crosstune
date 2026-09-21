import { describe, expect, it } from 'vitest'
import { lyricLines, lyricOpening } from './lyricLines'

describe('lyricLines', () => {
  it('splits verses on a blank line and keeps each line', () => {
    expect(lyricLines('one\ntwo\n\nthree')).toEqual([['one', 'two'], ['three']])
  })

  it('collapses a run of blank lines to one verse break', () => {
    expect(lyricLines('one\n\n\n\ntwo')).toEqual([['one'], ['two']])
  })

  it('normalizes CRLF and trims the ends', () => {
    expect(lyricLines('\r\n\r\none\r\ntwo\r\n\r\n')).toEqual([['one', 'two']])
  })

  it('drops the spaces around a line without touching its words', () => {
    expect(lyricLines('one   \n  two three ')).toEqual([['one', 'two three']])
  })

  it('reads a missing or blank body as no lyrics', () => {
    expect(lyricLines(null)).toEqual([])
    expect(lyricLines(undefined)).toEqual([])
    expect(lyricLines('   \n\n  ')).toEqual([])
  })
})

describe('lyricOpening', () => {
  it('takes the first lines across verses', () => {
    expect(lyricOpening('one\ntwo\n\nthree', 2)).toEqual(['one', 'two'])
    expect(lyricOpening('one\n\ntwo\nthree', 3)).toEqual(['one', 'two', 'three'])
  })

  it('gives nothing for a missing body', () => {
    expect(lyricOpening(null, 2)).toEqual([])
  })

  it('gives nothing for a negative count rather than every line but the last', () => {
    expect(lyricOpening('one\ntwo\nthree', -1)).toEqual([])
  })
})
