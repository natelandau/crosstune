/** A thumbnail row's height in CSS pixels. */
export const THUMBNAIL_HEIGHT = 120
// Decoded at twice the shown height so a thumbnail stays sharp on a high-density screen.
const THUMBNAIL_PIXELS = THUMBNAIL_HEIGHT * 2

/**
 * A small JPEG copy of a scan image for the thumbnail row. A full scan runs to 2400 px, and a
 * row of twenty decoded at that size would hold hundreds of megabytes, so each is decoded once
 * at the row's height. A scan shorter than that keeps its own size.
 */
export async function makeThumbnail(blob: Blob, scanHeight: number): Promise<Blob> {
  const resizeHeight = Math.max(1, Math.min(THUMBNAIL_PIXELS, scanHeight || THUMBNAIL_PIXELS))
  const bitmap = await createImageBitmap(blob, { resizeHeight, resizeQuality: 'high' })
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas context to draw the thumbnail on')
    context.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  } finally {
    bitmap.close()
  }
}
