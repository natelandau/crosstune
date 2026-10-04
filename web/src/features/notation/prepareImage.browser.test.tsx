import { describe, expect, it } from 'vitest'
import heicUrl from './fixtures/not-an-image.heic?url'
import largeUrl from './fixtures/large-6000x4000.jpg?url'
import rotatedUrl from './fixtures/rotated-exif.jpg?url'
import transparentUrl from './fixtures/transparent.png?url'
import { prepareImage, UndecodableImageError } from './prepareImage'

async function fixture(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url)
  return new File([await response.blob()], name, { type })
}

/** True when the JPEG carries an APP1 segment, which is where Exif lives. */
async function hasApp1(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let at = 2
  while (at + 3 < bytes.length && bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
    if (bytes[at + 1] === 0xe1) return true
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!)
  }
  return false
}

async function pixelAt(blob: Blob, x: number, y: number): Promise<number[]> {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')!
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]
}

describe('prepareImage', () => {
  it('scales the long edge to 2400', async () => {
    const result = await prepareImage(await fixture(largeUrl, 'large.jpg', 'image/jpeg'))
    expect([result.width, result.height]).toEqual([2400, 1600])
    const bitmap = await createImageBitmap(result.blob)
    expect([bitmap.width, bitmap.height]).toEqual([2400, 1600])
    bitmap.close()
  })

  it('applies EXIF orientation', async () => {
    const result = await prepareImage(await fixture(rotatedUrl, 'rotated.jpg', 'image/jpeg'))
    expect(result.width).toBeLessThan(result.height)
    expect([result.width, result.height]).toEqual([40, 60])
  })

  it('writes no EXIF', async () => {
    const source = await fixture(rotatedUrl, 'rotated.jpg', 'image/jpeg')
    expect(await hasApp1(source)).toBe(true)
    const result = await prepareImage(source)
    expect(await hasApp1(result.blob)).toBe(false)
  })

  it('fills transparency white', async () => {
    const result = await prepareImage(await fixture(transparentUrl, 'clear.png', 'image/png'))
    expect(await pixelAt(result.blob, 48, 48)).toEqual([255, 255, 255])
  })

  it('encodes jpeg', async () => {
    const result = await prepareImage(await fixture(transparentUrl, 'clear.png', 'image/png'))
    expect(result.blob.type).toBe('image/jpeg')
  })

  it('refuses an undecodable file', async () => {
    const file = await fixture(heicUrl, 'IMG_0001.heic', 'image/heic')
    const refused = await prepareImage(file).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(UndecodableImageError)
    expect(refused).toMatchObject({ fileName: 'IMG_0001.heic' })
  })
})
