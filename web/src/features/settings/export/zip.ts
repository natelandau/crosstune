/**
 * A stored-entry (method 0) zip writer for exports that can run past a gigabyte of audio.
 *
 * The result Blob is composed of header buffers and the input Blobs themselves, so entry bytes
 * are never copied into memory. Each entry is read once, chunk by chunk, only to compute its CRC.
 * Field layouts follow PKWARE's APPNOTE.TXT; every multi-byte field is little-endian.
 */

export interface ZipEntry {
  path: string
  data: Blob
}

export interface ZipOptions {
  modified: Date
  signal?: AbortSignal
  onEntry?: (done: number, total: number) => void
  /** Sizes and offsets at or over this use Zip64 fields. Lowered by tests to exercise Zip64. */
  zip64Threshold?: number
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EXTRA = 0x0001

const VERSION_STORED = 10
const VERSION_ZIP64 = 45
// Info-ZIP decodes the names of entries made on MS-DOS (host 0) as an OEM code page, which mangles
// UTF-8 names whatever bit 11 says, so entries claim Unix (host 3) with regular file permissions.
const MADE_BY_UNIX = 3 << 8
const VERSION_MADE_BY = MADE_BY_UNIX | 20
const VERSION_MADE_BY_ZIP64 = MADE_BY_UNIX | VERSION_ZIP64
const REGULAR_FILE_ATTRIBUTES = 0o100644 * 0x10000
const FLAG_UTF8_NAME = 0x0800
const MAX_UINT16 = 0xffff
const MAX_UINT32 = 0xffffffff

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** IEEE CRC-32. Pass the CRC of the bytes before `chunk` as `previous` to continue a stream. */
export function crc32(chunk: Uint8Array, previous = 0): number {
  let c = ~previous
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8)
  return ~c >>> 0
}

async function crc32OfBlob(blob: Blob, signal?: AbortSignal): Promise<number> {
  const reader = blob.stream().getReader()
  let crc = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) return crc
      crc = crc32(value, crc)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  // DOS dates span only 1980 through 2107; clamp to the nearest end.
  if (date.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }
  if (date.getFullYear() > 2107) {
    return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 }
  }
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

class Writer {
  readonly bytes: Uint8Array<ArrayBuffer>
  private readonly view: DataView
  private at = 0

  constructor(length: number) {
    this.bytes = new Uint8Array(length)
    this.view = new DataView(this.bytes.buffer)
  }

  u16(value: number): this {
    this.view.setUint16(this.at, value, true)
    this.at += 2
    return this
  }

  u32(value: number): this {
    this.view.setUint32(this.at, value, true)
    this.at += 4
    return this
  }

  u64(value: number): this {
    this.view.setBigUint64(this.at, BigInt(value), true)
    this.at += 8
    return this
  }

  raw(value: Uint8Array): this {
    this.bytes.set(value, this.at)
    this.at += value.length
    return this
  }
}

interface ZipRecord {
  name: Uint8Array
  crc: number
  size: number
  offset: number
  zip64: boolean
}

function localHeader(record: ZipRecord, time: number, date: number): Uint8Array<ArrayBuffer> {
  const extraLength = record.zip64 ? 4 + 16 : 0
  const w = new Writer(30 + record.name.length + extraLength)
    .u32(LOCAL_HEADER)
    .u16(record.zip64 ? VERSION_ZIP64 : VERSION_STORED)
    .u16(FLAG_UTF8_NAME)
    .u16(0)
    .u16(time)
    .u16(date)
    .u32(record.crc)
    .u32(record.zip64 ? MAX_UINT32 : record.size)
    .u32(record.zip64 ? MAX_UINT32 : record.size)
    .u16(record.name.length)
    .u16(extraLength)
    .raw(record.name)
  // The local Zip64 extra carries both sizes and never the offset.
  if (record.zip64) w.u16(ZIP64_EXTRA).u16(16).u64(record.size).u64(record.size)
  return w.bytes
}

function centralHeader(record: ZipRecord, time: number, date: number): Uint8Array<ArrayBuffer> {
  // A Zip64 record marks sizes and offset all as 0xFFFFFFFF, so its extra carries all three,
  // in the spec's order: uncompressed size, compressed size, local header offset.
  const extraLength = record.zip64 ? 4 + 24 : 0
  const w = new Writer(46 + record.name.length + extraLength)
    .u32(CENTRAL_HEADER)
    .u16(record.zip64 ? VERSION_MADE_BY_ZIP64 : VERSION_MADE_BY)
    .u16(record.zip64 ? VERSION_ZIP64 : VERSION_STORED)
    .u16(FLAG_UTF8_NAME)
    .u16(0)
    .u16(time)
    .u16(date)
    .u32(record.crc)
    .u32(record.zip64 ? MAX_UINT32 : record.size)
    .u32(record.zip64 ? MAX_UINT32 : record.size)
    .u16(record.name.length)
    .u16(extraLength)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(REGULAR_FILE_ATTRIBUTES)
    .u32(record.zip64 ? MAX_UINT32 : record.offset)
    .raw(record.name)
  if (record.zip64) {
    w.u16(ZIP64_EXTRA).u16(24).u64(record.size).u64(record.size).u64(record.offset)
  }
  return w.bytes
}

/**
 * Build a zip of stored entries. Directory entries are not written; entry paths imply them.
 * Throws `signal.reason` when aborted.
 */
export async function buildZip(entries: readonly ZipEntry[], options: ZipOptions): Promise<Blob> {
  const { modified, signal, onEntry } = options
  const threshold = Math.min(options.zip64Threshold ?? MAX_UINT32, MAX_UINT32)
  const { time, date } = dosDateTime(modified)
  const encoder = new TextEncoder()

  const parts: BlobPart[] = []
  const records: ZipRecord[] = []
  let offset = 0
  for (const entry of entries) {
    signal?.throwIfAborted()
    const size = entry.data.size
    const record: ZipRecord = {
      name: encoder.encode(entry.path),
      crc: await crc32OfBlob(entry.data, signal),
      size,
      offset,
      zip64: size >= threshold || offset >= threshold,
    }
    const header = localHeader(record, time, date)
    parts.push(header, entry.data)
    records.push(record)
    offset += header.length + size
    onEntry?.(records.length, entries.length)
  }

  const centralOffset = offset
  for (const record of records) {
    const header = centralHeader(record, time, date)
    parts.push(header)
    offset += header.length
  }
  const centralSize = offset - centralOffset

  const count = records.length
  // 0xFFFF is the classic record's Zip64 sentinel, so exactly 65,535 entries also needs Zip64.
  const countOverflows = count >= MAX_UINT16
  const sizeOverflows = centralSize >= threshold
  const offsetOverflows = centralOffset >= threshold
  if (records.some((r) => r.zip64) || countOverflows || sizeOverflows || offsetOverflows) {
    const zip64End = offset
    parts.push(
      new Writer(56)
        .u32(ZIP64_END_OF_CENTRAL_DIRECTORY)
        .u64(56 - 12)
        .u16(VERSION_ZIP64)
        .u16(VERSION_ZIP64)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(centralSize)
        .u64(centralOffset).bytes,
      new Writer(20).u32(ZIP64_LOCATOR).u32(0).u64(zip64End).u32(1).bytes,
    )
  }
  parts.push(
    new Writer(22)
      .u32(END_OF_CENTRAL_DIRECTORY)
      .u16(0)
      .u16(0)
      .u16(countOverflows ? MAX_UINT16 : count)
      .u16(countOverflows ? MAX_UINT16 : count)
      .u32(sizeOverflows ? MAX_UINT32 : centralSize)
      .u32(offsetOverflows ? MAX_UINT32 : centralOffset)
      .u16(0).bytes,
  )

  return new Blob(parts, { type: 'application/zip' })
}
