const BOM = '﻿'

function encodeField(field: string): string {
  const value = field.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** A UTF-8 CSV document: BOM, CRLF-terminated records, RFC 4180 quoting. */
export function csvDocument(rows: readonly (readonly string[])[]): string {
  return BOM + rows.map((row) => `${row.map(encodeField).join(',')}\r\n`).join('')
}
