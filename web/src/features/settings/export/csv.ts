const BOM = '﻿'

// A spreadsheet reads a cell starting with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
// A spreadsheet reads a time signature like 6/8 as a date.
const SLASHED_NUMBERS = /^\d+\/\d+(\/\d+)?$/

/**
 * The cell as written, or with a leading quote when a spreadsheet would run it as a formula or
 * read it as a date.
 */
function guarded(field: string): string {
  const formula = FORMULA_START.test(field) && !NUMBER.test(field)
  return formula || SLASHED_NUMBERS.test(field) ? `'${field}` : field
}

function encodeField(field: string): string {
  const value = guarded(field).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * A UTF-8 CSV document: BOM, CRLF-terminated records, RFC 4180 quoting. A cell a spreadsheet
 * would run as a formula or read as a date starts with a quote; a number never does.
 */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((row) => `${row.map(encodeField).join(',')}\r\n`).join('')
}
