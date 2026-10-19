const BOM = '﻿'

// A spreadsheet reads a cell starting with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
// A spreadsheet reads numbers joined by slashes or dashes, like the time signature 6/8, as a date.
const DATE_LIKE = /^\s*\d+([/-])\d+(\1\d+)?\s*$/
const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?$/

/**
 * The cell as written, or with a leading quote when a spreadsheet would run it as a formula or
 * misread it as a date.
 */
function guarded(field: string): string {
  const formula = FORMULA_START.test(field) && !NUMBER.test(field)
  const date = DATE_LIKE.test(field) && !ISO_DATE.test(field)
  return formula || date ? `'${field}` : field
}

function encodeField(field: string): string {
  const value = guarded(field).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * A UTF-8 CSV document: BOM, CRLF-terminated records, RFC 4180 quoting. A cell a spreadsheet
 * would run as a formula or misread as a date starts with a quote; a number or an ISO date never
 * does.
 */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((row) => `${row.map(encodeField).join(',')}\r\n`).join('')
}
