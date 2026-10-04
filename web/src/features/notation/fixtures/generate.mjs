// Writes the prepareImage test fixtures into this directory. Needs macOS for `sips`, which does
// the JPEG encoding; everything else is Node's standard library.
//   node web/src/features/notation/fixtures/generate.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const here = fileURLToPath(new URL('.', import.meta.url))

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** An 8-bit RGBA PNG whose pixels come from `pixel(x, y)`. */
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function jpegFrom(pngBytes, quality) {
  const dir = mkdtempSync(join(tmpdir(), 'notation-fixtures-'))
  try {
    const source = join(dir, 'in.png')
    const target = join(dir, 'out.jpg')
    writeFileSync(source, pngBytes)
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), source, '--out', target],
      {
        stdio: 'ignore',
      },
    )
    return readFileSync(target)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Drop every APP1 segment the encoder wrote and put in one Exif block holding only `orientation`. */
function withOrientation(jpeg, orientation) {
  const tiff = Buffer.from(
    [
      '4d4d002a00000008', // big-endian TIFF header, IFD0 at offset 8
      '0001', // one entry
      `011200030000000100${orientation.toString(16).padStart(2, '0')}0000`, // Orientation, SHORT
      '00000000', // no next IFD
    ].join(''),
    'hex',
  )
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const app1 = Buffer.alloc(4)
  app1.writeUInt16BE(0xffe1, 0)
  app1.writeUInt16BE(body.length + 2, 2)

  const kept = []
  let at = 2
  while (jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const length = jpeg.readUInt16BE(at + 2)
    if (jpeg[at + 1] !== 0xe1) kept.push(jpeg.subarray(at, at + 2 + length))
    at += 2 + length
  }
  // Exif belongs after a JFIF APP0, which readers expect to come first.
  const jfif = kept[0]?.[1] === 0xe0 ? kept.splice(0, 1) : []
  return Buffer.concat([jpeg.subarray(0, 2), ...jfif, app1, body, ...kept, jpeg.subarray(at)])
}

// Stored 60 wide by 40 tall; orientation 6 tells a viewer to turn it a quarter clockwise.
const landscape = png(60, 40, (x) => (x < 30 ? [200, 40, 40, 255] : [40, 40, 200, 255]))
writeFileSync(join(here, 'rotated-exif.jpg'), withOrientation(jpegFrom(landscape, 80), 6))

// Flat color keeps a 24-megapixel file small enough to commit.
const flat = png(6000, 4000, () => [120, 140, 160, 255])
writeFileSync(join(here, 'large-6000x4000.jpg'), jpegFrom(flat, 10))

// Clear everywhere except an opaque black square in the top-left corner.
writeFileSync(
  join(here, 'transparent.png'),
  png(64, 64, (x, y) => (x < 16 && y < 16 ? [0, 0, 0, 255] : [0, 0, 0, 0])),
)

// HEIC's container header with no image inside: Chromium decodes no HEIC at all.
writeFileSync(
  join(here, 'not-an-image.heic'),
  Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic')]),
)
