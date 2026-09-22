import { PROVIDERS, type Provider } from '../../constants'

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const SPOTIFY_PATH = /^\/(?:intl-[a-z]{2}\/)?(track|album|episode|playlist)\/([A-Za-z0-9]+)/
// listen.tidal.com nests a track under its album; the track is the recording.
const TIDAL_PATH = /^\/(?:browse\/)?(?:album\/\d+\/)?(track|album|playlist|video)\/([0-9A-Fa-f-]+)/
const ARCHIVE_PATH = /^\/details\/([A-Za-z0-9._-]+)/

function typedRef(pattern: RegExp, url: URL): string | null {
  const match = pattern.exec(url.pathname)
  return match ? `${match[1]}:${match[2]}` : null
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

function host(url: URL): string {
  const h = url.hostname.toLowerCase()
  return h.startsWith('www.') || h.startsWith('m.') ? h.slice(h.indexOf('.') + 1) : h
}

function youtubeRef(url: URL): string | null {
  let candidate: string | null = null
  if (url.pathname === '/watch') {
    candidate = url.searchParams.get('v')
  } else {
    const prefix = ['/shorts/', '/embed/', '/live/'].find((p) => url.pathname.startsWith(p))
    if (prefix) candidate = url.pathname.split('/')[2] ?? null
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
}

function appleRef(url: URL): string | null {
  const i = url.searchParams.get('i')
  if (i) return i
  const last = url.pathname.replace(/\/$/, '').split('/').pop() ?? ''
  return /^\d+$/.test(last) ? last : null
}

export function detectProvider(raw: string): { provider: Provider; provider_ref: string | null } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { provider: 'other', provider_ref: null }
  }
  const h = host(url)
  if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
    return { provider: 'youtube', provider_ref: youtubeRef(url) }
  }
  if (h === 'youtu.be') {
    const id = url.pathname.replace(/^\/|\/$/g, '')
    return { provider: 'youtube', provider_ref: YOUTUBE_ID.test(id) ? id : null }
  }
  if (h === 'open.spotify.com') {
    return { provider: 'spotify', provider_ref: typedRef(SPOTIFY_PATH, url) }
  }
  if (h === 'music.apple.com') return { provider: 'apple_music', provider_ref: appleRef(url) }
  if (h === 'bandcamp.com' || h.endsWith('.bandcamp.com')) {
    return { provider: 'bandcamp', provider_ref: null }
  }
  if (h === 'soundcloud.com') return { provider: 'soundcloud', provider_ref: null }
  if (h === 'tidal.com' || h === 'listen.tidal.com') {
    return { provider: 'tidal', provider_ref: typedRef(TIDAL_PATH, url) }
  }
  if (h === 'archive.org') {
    const match = ARCHIVE_PATH.exec(url.pathname)
    return { provider: 'internet_archive', provider_ref: match ? match[1]! : null }
  }
  return { provider: 'other', provider_ref: null }
}

export function youtubeId(link: { provider: string; provider_ref?: string | null }): string | null {
  return link.provider === 'youtube' && link.provider_ref && YOUTUBE_ID.test(link.provider_ref)
    ? link.provider_ref
    : null
}
