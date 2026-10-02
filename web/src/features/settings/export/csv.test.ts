import { expect, test } from 'vitest'
import { csvDocument } from './csv'

const BOM = '﻿'

test('quotes only fields that need it and doubles inner quotes', () => {
  expect(csvDocument([['a', 'b,c', 'say "hi"', 'x\ny']])).toBe(
    `${BOM}a,"b,c","say ""hi""","x\ny"\r\n`,
  )
})

test('keeps a leading = or - as written', () => {
  expect(csvDocument([['=SUM(A1)', '- note']])).toBe(`${BOM}=SUM(A1),- note\r\n`)
})

test('normalizes CRLF inside a field to LF', () => {
  expect(csvDocument([['a\r\nb']])).toBe(`${BOM}"a\nb"\r\n`)
})

test('turns a lone CR inside a field into LF', () => {
  expect(csvDocument([['a\rb', 'c\r\r\nd']])).toBe(`${BOM}"a\nb","c\n\nd"\r\n`)
})

test('ends every record with CRLF and an empty document is only the BOM', () => {
  expect(csvDocument([['a'], ['b']])).toBe(`${BOM}a\r\nb\r\n`)
  expect(csvDocument([])).toBe(BOM)
})
