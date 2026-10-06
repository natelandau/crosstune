import type { ImageMetadata } from 'astro'
import manifest from '../../assets/captures/captures.json'
import type { CaptureEntry, Manifest } from '../../../capture/types.ts'

// Plain module (no astro:assets) so vitest can import it directly.
const urls = import.meta.glob<string>('../../assets/captures/*.mp4', {
  eager: true,
  query: '?url',
  import: 'default',
})
const images = import.meta.glob<ImageMetadata | string>('../../assets/captures/*.png', {
  eager: true,
  import: 'default',
})

const captures = (manifest as Manifest).captures

/** The iPhone captures' screen in pixels, which every phone frame takes its shape from. */
export const PHONE_SCREEN = { width: 1206, height: 2622 } as const

/**
 * How a clip's poster loads, as an `<img>` under the video: `high` for the page's largest
 * first-view image, `low` for one hidden now that must show the moment it is revealed, which
 * `lazy` never loads while hidden.
 */
export type Poster = 'high' | 'low' | 'lazy'

export type Capture = CaptureEntry & {
  /** Hashed video URL for a clip, or image metadata for a still. */
  src: ImageMetadata | string
  /** Image metadata for the poster (clips) or the still itself. */
  asset: ImageMetadata | string
}

function lookup<T>(files: Record<string, T>, file: string): T {
  const found = files[`../../assets/captures/${file}`]
  if (found === undefined) throw new Error(`Capture file missing: ${file}`)
  return found
}

/** Whether the manifest has `name`, for a capture the page can show once it is recorded. */
export function hasCapture(name: string): boolean {
  return Object.hasOwn(captures, name)
}

export function getCapture(name: string): Capture {
  const entry = hasCapture(name) ? captures[name] : undefined
  if (!entry) throw new Error(`Unknown capture: ${name}`)
  if (entry.kind === 'clip') {
    const image = lookup(images, entry.poster)
    return { ...entry, src: lookup(urls, entry.video), asset: image }
  }
  const image = lookup(images, entry.image)
  return { ...entry, src: image, asset: image }
}
