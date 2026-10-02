const MAX_GRAPHEMES = 100
const FALLBACK = 'Untitled'

const segmenter = new Intl.Segmenter()

// Path separators, Windows-reserved characters, and control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001F\u007F-\u009F]/g

// Windows refuses these device names as a file or folder, whatever follows a first dot.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

function trimEnds(name: string): string {
  return name.replace(/^\s+/, '').replace(/[\s.]+$/, '')
}

/** A file or folder name that is valid on macOS, Windows, and in a zip. */
export function safeName(raw: string): string {
  const cleaned = trimEnds(raw.normalize('NFC').replace(FORBIDDEN, ' ').replace(/\s+/g, ' '))
  const cut = [...segmenter.segment(cleaned)]
    .slice(0, MAX_GRAPHEMES)
    .map((part) => part.segment)
    .join('')
  const safe = trimEnds(cut) || FALLBACK
  return RESERVED.test(safe) ? `_${safe}` : safe
}

/** Hands out names that stay unique on case-insensitive filesystems. */
export class NameAllocator {
  private readonly used: Set<string>

  /** `reserved` names are never handed out, as if taken before any other. */
  constructor(reserved: readonly string[] = []) {
    this.used = new Set(reserved.map(key))
  }

  take(raw: string, ext?: string): string {
    const base = safeName(raw)
    const suffix = ext ? `.${ext}` : ''
    let candidate = base + suffix
    for (let n = 2; this.used.has(key(candidate)); n += 1) {
      candidate = `${base} (${n})${suffix}`
    }
    this.used.add(key(candidate))
    return candidate
  }
}

function key(name: string): string {
  return name.toLocaleLowerCase('en')
}
