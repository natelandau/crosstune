import { expect, test } from 'vitest'
import { csvDocument } from './csv'

const BOM = '﻿'

test('quotes only fields that need it and doubles inner quotes', () => {
  expect(csvDocument([['a', 'b,c', 'say "hi"', 'x\ny']])).toBe(
    `${BOM}a,"b,c","say ""hi""","x\ny"\r\n`,
  )
})

test('guards a cell a spreadsheet would read as a formula', () => {
  expect(csvDocument([['=SUM(A1)', '+1 555', '- note', '@user', '\tx', '\rx']])).toBe(
    `${BOM}'=SUM(A1),'+1 555,'- note,'@user,'\tx,"'\nx"\r\n`,
  )
})

test('leaves a number as written', () => {
  expect(csvDocument([['-80.92', '+5', '-0.5', '36', '-.5']])).toBe(
    `${BOM}-80.92,+5,-0.5,36,-.5\r\n`,
  )
})

test('guards a formula that also needs quotes', () => {
  expect(csvDocument([['=A1,"x"']])).toBe(`${BOM}"'=A1,""x"""\r\n`)
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
