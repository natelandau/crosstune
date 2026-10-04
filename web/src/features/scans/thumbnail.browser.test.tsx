import { describe, expect, it } from 'vitest'
import { jpegBlob } from '../../test/rows'
import { makeThumbnail, THUMBNAIL_HEIGHT } from './thumbnail'

async function heightOf(blob: Blob): Promise<number> {
  const bitmap = await createImageBitmap(blob)
  const { height } = bitmap
  bitmap.close()
  return height
}

describe('makeThumbnail', () => {
  it('decodes a tall scan at twice the row height', async () => {
    const thumbnail = await makeThumbnail(await jpegBlob(600, 800), 800)
    expect(await heightOf(thumbnail)).toBe(THUMBNAIL_HEIGHT * 2)
  })

  it('never draws a thumbnail larger than its scan', async () => {
    const thumbnail = await makeThumbnail(await jpegBlob(60, 80), 80)
    expect(await heightOf(thumbnail)).toBe(80)
  })
})
