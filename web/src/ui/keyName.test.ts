import { expect, it } from 'vitest'
import { spokenKey } from './keyName'

it('says an accidental in words', () => {
  expect(spokenKey('F#')).toBe('F sharp')
  expect(spokenKey('Bb')).toBe('B flat')
  expect(spokenKey('E♭')).toBe('E flat')
  expect(spokenKey('c♯')).toBe('C sharp')
})

it('leaves a natural key and other text as they are', () => {
  expect(spokenKey('D')).toBe('D')
  expect(spokenKey('Am')).toBe('Am')
  expect(spokenKey('Hb')).toBe('Hb')
  expect(spokenKey('bb')).toBe('B flat')
})
