import { unzipSync } from 'fflate'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { buildZip, crc32 } from './zip'

const UNIX_MADE_BY = (3 << 8) | 20
const UNIX_MADE_BY_ZIP64 = (3 << 8) | 45
const REGULAR_FILE_ATTRIBUTES = 0o100644 * 0x10000
const hasUnzip = spawnSync('unzip', ['-v']).status === 0

function findSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (view.getUint32(i, true) === signature) return i
  }
  return -1
}

test('crc32 of "123456789" is 0xCBF43926', () => {
  expect(crc32(new TextEncoder().encode('123456789')) >>> 0).toBe(0xcbf43926)
})

test('crc32 continues across chunks', () => {
  const whole = crc32(new TextEncoder().encode('123456789'))
  const split = crc32(new TextEncoder().encode('6789'), crc32(new TextEncoder().encode('12345')))
  expect(split >>> 0).toBe(whole >>> 0)
})

test('round-trips names, bytes, and method 0', async () => {
  const zip = await buildZip(
    [
      { path: 'tunes.csv', data: new Blob(['a,b\r\n']) },
      { path: 'recordings/Ríl Mhór/2026-09-20.m4a', data: new Blob([new Uint8Array([1, 2, 3])]) },
    ],
    { modified: new Date('2026-10-02T12:00:00') },
  )
  const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
  expect(Object.keys(files)).toEqual(['tunes.csv', 'recordings/Ríl Mhór/2026-09-20.m4a'])
  expect(files['recordings/Ríl Mhór/2026-09-20.m4a']).toEqual(new Uint8Array([1, 2, 3]))
})

test('marks each central entry as made on Unix with regular file permissions', async () => {
  const zip = await buildZip([{ path: 'a', data: new Blob(['x']) }], { modified: new Date() })
  const bytes = new Uint8Array(await zip.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const central = findSignature(bytes, 0x02014b50)
  expect(view.getUint16(central + 4, true)).toBe(UNIX_MADE_BY)
  expect(view.getUint16(central + 6, true)).toBe(10)
  expect(view.getUint32(central + 38, true)).toBe(REGULAR_FILE_ATTRIBUTES)
})

test.skipIf(!hasUnzip)('Info-ZIP extracts an accented path with its bytes', async () => {
  const audio = new Uint8Array([1, 2, 3, 250])
  const zip = await buildZip(
    [{ path: 'recordings/Ríl Mhór/2026-09-20.m4a', data: new Blob([audio]) }],
    { modified: new Date() },
  )
  const folder = mkdtempSync(join(tmpdir(), 'crosstune-zip-'))
  try {
    const file = join(folder, 'export.zip')
    writeFileSync(file, new Uint8Array(await zip.arrayBuffer()))
    const result = spawnSync('unzip', ['-q', file, '-d', join(folder, 'out')], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const extracted = readFileSync(join(folder, 'out', 'recordings', 'Ríl Mhór', '2026-09-20.m4a'))
    expect(new Uint8Array(extracted)).toEqual(audio)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('writes Zip64 records past the threshold and still reads back', async () => {
  const zip = await buildZip(
    [
      { path: 'a', data: new Blob(['x'.repeat(64)]) },
      { path: 'b', data: new Blob(['y']) },
    ],
    { modified: new Date(), zip64Threshold: 32 },
  )
  const bytes = new Uint8Array(await zip.arrayBuffer())
  expect(findSignature(bytes, 0x06064b50)).toBeGreaterThan(-1)
  const files = unzipSync(bytes)
  expect(Object.keys(files)).toEqual(['a', 'b'])
  expect(new TextDecoder().decode(files.a)).toBe('x'.repeat(64))
  expect(new TextDecoder().decode(files.b)).toBe('y')
})

test('lays out Zip64 extras and end records, with sentinels only where fields overflow', async () => {
  // 'a' is over the threshold by size and 'b' by offset; the central directory starts past the
  // threshold but its size stays under it, and the entry count never overflows.
  const zip = await buildZip(
    [
      { path: 'a', data: new Blob(['x'.repeat(200)]) },
      { path: 'b', data: new Blob(['y']) },
    ],
    { modified: new Date(), zip64Threshold: 160 },
  )
  const bytes = new Uint8Array(await zip.arrayBuffer())
  const view = new DataView(bytes.buffer)

  expect(view.getUint32(0, true)).toBe(0x04034b50)
  expect(view.getUint16(4, true)).toBe(45)
  expect(view.getUint32(18, true)).toBe(0xffffffff)
  expect(view.getUint32(22, true)).toBe(0xffffffff)
  expect(view.getUint16(28, true)).toBe(20)
  const localExtra = 30 + 1
  expect(view.getUint16(localExtra, true)).toBe(0x0001)
  expect(view.getUint16(localExtra + 2, true)).toBe(16)
  expect(view.getBigUint64(localExtra + 4, true)).toBe(200n)
  expect(view.getBigUint64(localExtra + 12, true)).toBe(200n)

  const end = bytes.length - 22
  const locator = end - 20
  const central = findSignature(bytes, 0x02014b50)
  const zip64End = Number(view.getBigUint64(locator + 8, true))
  const centralSize = zip64End - central
  expect(central).toBe(51 + 200 + 51 + 1)
  expect(centralSize).toBeLessThan(160)
  expect(view.getUint16(central + 4, true)).toBe(UNIX_MADE_BY_ZIP64)
  expect(view.getUint16(central + 6, true)).toBe(45)
  expect(view.getUint32(central + 38, true)).toBe(REGULAR_FILE_ATTRIBUTES)

  expect(view.getUint32(zip64End, true)).toBe(0x06064b50)
  expect(view.getBigUint64(zip64End + 4, true)).toBe(44n)
  expect(view.getUint16(zip64End + 12, true)).toBe(45)
  expect(view.getUint16(zip64End + 14, true)).toBe(45)
  expect(view.getUint32(zip64End + 16, true)).toBe(0)
  expect(view.getUint32(zip64End + 20, true)).toBe(0)
  expect(view.getBigUint64(zip64End + 24, true)).toBe(2n)
  expect(view.getBigUint64(zip64End + 32, true)).toBe(2n)
  expect(view.getBigUint64(zip64End + 40, true)).toBe(BigInt(centralSize))
  expect(view.getBigUint64(zip64End + 48, true)).toBe(BigInt(central))

  expect(view.getUint32(locator, true)).toBe(0x07064b50)
  expect(view.getUint32(locator + 4, true)).toBe(0)
  expect(view.getUint32(locator + 16, true)).toBe(1)

  expect(view.getUint32(end, true)).toBe(0x06054b50)
  expect(view.getUint16(end + 4, true)).toBe(0)
  expect(view.getUint16(end + 6, true)).toBe(0)
  expect(view.getUint16(end + 8, true)).toBe(2)
  expect(view.getUint16(end + 10, true)).toBe(2)
  expect(view.getUint32(end + 12, true)).toBe(centralSize)
  expect(view.getUint32(end + 16, true)).toBe(0xffffffff)
})

test('writes no Zip64 records under the threshold', async () => {
  const zip = await buildZip([{ path: 'a', data: new Blob(['x']) }], { modified: new Date() })
  const bytes = new Uint8Array(await zip.arrayBuffer())
  expect(findSignature(bytes, 0x06064b50)).toBe(-1)
})

test('stamps the local DOS time and date of modified', async () => {
  const zip = await buildZip([{ path: 'a', data: new Blob(['x']) }], {
    modified: new Date(2026, 9, 2, 13, 45, 31),
  })
  const view = new DataView(await zip.arrayBuffer())
  expect(view.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 15)
  expect(view.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 2)
})

test('clamps DOS dates after 2107 to the last representable moment', async () => {
  const zip = await buildZip([{ path: 'a', data: new Blob(['x']) }], {
    modified: new Date(2200, 0, 1),
  })
  const view = new DataView(await zip.arrayBuffer())
  expect(view.getUint16(10, true)).toBe((23 << 11) | (59 << 5) | 29)
  expect(view.getUint16(12, true)).toBe((127 << 9) | (12 << 5) | 31)
})

test('reports progress after each entry', async () => {
  const calls: [number, number][] = []
  await buildZip(
    [
      { path: 'a', data: new Blob(['x']) },
      { path: 'b', data: new Blob(['y']) },
    ],
    { modified: new Date(), onEntry: (done, total) => calls.push([done, total]) },
  )
  expect(calls).toEqual([
    [1, 2],
    [2, 2],
  ])
})

test('stops when aborted', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(
    buildZip([{ path: 'a', data: new Blob(['x']) }], {
      modified: new Date(),
      signal: controller.signal,
    }),
  ).rejects.toThrow('cancelled')
})

test('stops between chunks and cancels the stream when aborted mid-entry', async () => {
  const controller = new AbortController()
  const reason = new Error('cancelled')
  let pulls = 0
  let cancelled: unknown
  // highWaterMark 0 makes the stream pull only on read, so the abort lands after the first chunk.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(source) {
        pulls++
        source.enqueue(new Uint8Array([1, 2, 3]))
        controller.abort(reason)
      },
      cancel(why) {
        cancelled = why
      },
    },
    { highWaterMark: 0 },
  )
  const data = { size: 6, stream: () => stream } as unknown as Blob
  await expect(
    buildZip([{ path: 'a', data }], { modified: new Date(), signal: controller.signal }),
  ).rejects.toBe(reason)
  expect(pulls).toBe(1)
  expect(cancelled).toBe(reason)
})

test('stops before the next entry when aborted between entries', async () => {
  const controller = new AbortController()
  const second = new Blob(['y'])
  const read = vi.spyOn(second, 'stream')
  await expect(
    buildZip(
      [
        { path: 'a', data: new Blob(['x']) },
        { path: 'b', data: second },
      ],
      {
        modified: new Date(),
        signal: controller.signal,
        onEntry: () => controller.abort(new Error('cancelled')),
      },
    ),
  ).rejects.toThrow('cancelled')
  expect(read).not.toHaveBeenCalled()
})
