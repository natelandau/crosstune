import { describe, expect, test } from 'vitest'
import { readTextFile } from './readTextFile'

const TEXT = "Soldier's Joy\nFête"

function utf16(text: string, littleEndian: boolean): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + text.length * 2)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xfeff, littleEndian)
  for (let i = 0; i < text.length; i += 1)
    view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian)
  return bytes
}

function fileOf(bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], 'tunes.txt', { type: 'text/plain' })
}

describe('readTextFile', () => {
  test('reads UTF-8', async () => {
    expect(await readTextFile(fileOf(new TextEncoder().encode(TEXT)))).toBe(TEXT)
  })

  test('drops a UTF-8 byte-order mark', async () => {
    const body = new TextEncoder().encode(TEXT)
    const bytes = new Uint8Array(3 + body.length)
    bytes.set([0xef, 0xbb, 0xbf])
    bytes.set(body, 3)
    expect(await readTextFile(fileOf(bytes))).toBe(TEXT)
  })

  test('reads UTF-16LE by its byte-order mark', async () => {
    expect(await readTextFile(fileOf(utf16(TEXT, true)))).toBe(TEXT)
  })

  test('reads UTF-16BE by its byte-order mark', async () => {
    expect(await readTextFile(fileOf(utf16(TEXT, false)))).toBe(TEXT)
  })

  test('decodes bytes that are not UTF-8 as replacement characters', async () => {
    expect(await readTextFile(fileOf(new Uint8Array([0x41, 0xff, 0x42])))).toBe('A\uFFFDB')
  })

  test('ends an odd-length UTF-16 file with a replacement character', async () => {
    const bytes = new Uint8Array([...utf16('A', true), 0x42])
    expect(await readTextFile(fileOf(bytes))).toBe('A\uFFFD')
  })

  test('reads an empty file, or one with only a byte-order mark, as no text', async () => {
    for (const bytes of [[], [0xef, 0xbb, 0xbf], [0xff, 0xfe], [0xfe, 0xff]]) {
      expect(await readTextFile(fileOf(new Uint8Array(bytes)))).toBe('')
    }
  })
})
