const MAX_EDGE = 2400
const JPEG_QUALITY = 0.75

/** The browser could not read the file as an image, as Chrome with HEIC. */
export class UndecodableImageError extends Error {
  override readonly name = 'UndecodableImageError'
  constructor(
    readonly fileName: string,
    cause: unknown,
  ) {
    super(`${fileName} is not an image this browser can read`, { cause })
  }
}

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Turn a picked file into the JPEG a notation page stores: upright, at most 2400 px on its long
 * edge, transparency on white. Re-encoding from pixels leaves the original's EXIF and location
 * behind.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    throw new UndecodableImageError(file.name, error)
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas context to draw the image on')
    // JPEG has no alpha, and an encoder left to itself turns clear pixels black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}
