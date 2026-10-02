import { expect, test } from 'vitest'
import { NameAllocator, safeName } from './safeName'

test.each([
  ['Jam: Ray/Sue', 'Jam Ray Sue'],
  ['  spaced   out  ', 'spaced out'],
  ['ends with dots...', 'ends with dots'],
  ['???', 'Untitled'],
  ['...', 'Untitled'],
  ['Café', 'Café'],
  ['Con', '_Con'],
  ['nul.Brio', '_nul.Brio'],
  ['COM1', '_COM1'],
  ['Console', 'Console'],
  ['COM0', 'COM0'],
])('safeName(%j) is %j', (raw, safe) => expect(safeName(raw)).toBe(safe))

test('normalizes to NFC', () => {
  expect(safeName('Cafe\u0301')).toBe('Café')
})

test('cuts to 100 graphemes without splitting one', () => {
  expect([...new Intl.Segmenter().segment(safeName('👍🏽'.repeat(150)))]).toHaveLength(100)
})

test('suffixes case-insensitive collisions before the extension', () => {
  const names = new NameAllocator(['Unfiled'])
  expect(names.take('unfiled')).toBe('unfiled (2)')
  expect(names.take('Take', 'm4a')).toBe('Take.m4a')
  expect(names.take('take', 'm4a')).toBe('take (2).m4a')
})

test('does not collide across extensions and counts upward', () => {
  const names = new NameAllocator()
  expect(names.take('take', 'm4a')).toBe('take.m4a')
  expect(names.take('take', 'aac')).toBe('take.aac')
  expect(names.take('take', 'm4a')).toBe('take (2).m4a')
  expect(names.take('take', 'm4a')).toBe('take (3).m4a')
})
