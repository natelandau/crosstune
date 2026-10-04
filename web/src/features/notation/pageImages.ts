import { useEffect, useRef, useState } from 'react'
import type { NotationFile } from '../../db/notation'
import { useLatest } from '../../ui/useLatest'

/** A thumbnail row's height in CSS pixels. */
export const THUMBNAIL_HEIGHT = 120
// Decoded at twice the shown height so a thumbnail stays sharp on a high-density screen.
const THUMBNAIL_PIXELS = THUMBNAIL_HEIGHT * 2

/** A page's width over its height, guarded against a row that carries no size. */
export function aspectRatio({ width, height }: { width: number; height: number }): number {
  return width > 0 && height > 0 ? width / height : 3 / 4
}

export type PageImage = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'broken' }

/**
 * Names a page's bytes. Every read of the store hands back a new Blob for the same file, so
 * the blob's identity cannot say whether the image changed; a page's file never changes once
 * stored, so its id and size can.
 */
export function imageKey(file: NotationFile | undefined): string | undefined {
  return file ? `${file.id}:${file.blob.size}` : undefined
}

/**
 * An object URL for an image made from `blob`, decoded before it is handed out so a file the
 * browser cannot read is known as broken rather than drawn as an empty box. It decodes again
 * only when `key` changes, keeps showing the last image until the next one is ready, and
 * revokes each URL once nothing can show it, including as soon as `key` is undefined. Nothing
 * decodes until `enabled` is first true; after that the URL stays, so a page scrolled out of
 * reach and back needs no second decode.
 */
function useDecodedImage(
  key: string | undefined,
  blob: Blob | undefined,
  prepare: (blob: Blob) => Promise<Blob>,
  { enabled = true, onBroken }: { enabled?: boolean; onBroken?: () => void } = {},
): PageImage {
  const [wanted, setWanted] = useState<string | undefined>(enabled ? key : undefined)
  const [state, setState] = useState<PageImage>({ kind: 'loading' })
  if (key === undefined ? wanted !== undefined : enabled && wanted !== key) {
    setWanted(key)
    // The shown URL is revoked below, so a file that comes back must not show it meanwhile.
    if (key === undefined) setState({ kind: 'loading' })
  }
  const blobRef = useLatest(blob)
  const prepareRef = useLatest(prepare)
  const onBrokenRef = useLatest(onBroken)
  const shownUrl = useRef<string | null>(null)

  useEffect(
    () => () => {
      if (shownUrl.current) URL.revokeObjectURL(shownUrl.current)
    },
    [],
  )

  useEffect(() => {
    if (wanted === undefined && shownUrl.current) {
      URL.revokeObjectURL(shownUrl.current)
      shownUrl.current = null
    }
    const source = blobRef.current
    if (wanted === undefined || !source) return
    let live = true
    let url: string | null = null
    const take = (image: PageImage) => {
      const previous = shownUrl.current
      shownUrl.current = image.kind === 'ready' ? image.url : null
      if (previous) URL.revokeObjectURL(previous)
      setState(image)
    }
    prepareRef
      .current(source)
      .then(async (prepared) => {
        if (!live) return
        url = URL.createObjectURL(prepared)
        const probe = new Image()
        probe.src = url
        await probe.decode()
        if (!live) return
        take({ kind: 'ready', url })
        url = null
      })
      .catch(() => {
        if (!live) return
        take({ kind: 'broken' })
        onBrokenRef.current?.()
      })
      .finally(() => {
        // A URL made for a decode that failed or was overtaken is never shown.
        if (url) URL.revokeObjectURL(url)
      })
    return () => {
      live = false
    }
  }, [wanted, blobRef, prepareRef, onBrokenRef])

  return wanted === undefined ? { kind: 'loading' } : state
}

const asIs = (blob: Blob) => Promise.resolve(blob)

/** A full page image. Only decoded once `enabled`, so a viewer can hold back pages out of reach. */
export function usePageImage(
  file: NotationFile | undefined,
  options: { enabled?: boolean; onBroken?: () => void } = {},
): PageImage {
  return useDecodedImage(imageKey(file), file?.blob, asIs, options)
}

/**
 * A small copy of a page image for the thumbnail row. A full page runs to 2400 px, and a row of
 * twenty decoded at that size would hold hundreds of megabytes, so each is decoded once at the
 * row's height and kept as a small JPEG. A page shorter than that keeps its own size.
 */
export function useThumbnail(file: NotationFile | undefined, pageHeight: number): PageImage {
  const resizeHeight = Math.max(1, Math.min(THUMBNAIL_PIXELS, pageHeight || THUMBNAIL_PIXELS))
  const prepare = async (blob: Blob) => {
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
  return useDecodedImage(imageKey(file), file?.blob, prepare)
}
