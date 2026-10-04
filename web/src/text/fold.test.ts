import { describe, expect, test } from 'vitest'
import cases from '../../../fixtures/text/fold.json'
import { containsText, foldText, sameText } from './fold'

describe('foldText', () => {
  // The Swift client reads the same file, so both clients fold every value the same way.
  test.each(cases.map(({ input, key }) => [JSON.stringify(input), input, key]))(
    'folds %s',
    (_name, input, key) => {
      expect(foldText(input)).toBe(key)
    },
  )
})

describe('sameText', () => {
  test('matches spellings that differ only by case, accents, or outer whitespace', () => {
    expect(sameText('Irish', ' ÍRISH ')).toBe(true)
    expect(sameText('Fête', 'Fête')).toBe(true)
  })

  test('keeps different letters apart', () => {
    expect(sameText('Straße', 'Strasse')).toBe(false)
    expect(sameText('ı', 'i')).toBe(false)
  })
})

describe('containsText', () => {
  test('finds a folded needle anywhere in the haystack', () => {
    expect(containsText('The Été Waltz', 'ete wal')).toBe(true)
  })

  test('trims the needle, so inner spaces still count', () => {
    expect(containsText('Ete Waltz', '  ete  ')).toBe(true)
    expect(containsText('Ete Waltz', 'ete  waltz')).toBe(false)
  })

  test('finds a word ending in sigma at the start of a longer word', () => {
    expect(
      containsText('\u039f\u03b4\u03bf\u03c3\u03ac\u03ba\u03b7\u03c2', '\u039f\u0394\u039f\u03a3'),
    ).toBe(true)
  })

  test('finds an empty needle in anything', () => {
    expect(containsText('Reel', '')).toBe(true)
  })
})
