import type { LocalRecordingLink } from '../../db/types'
import { youtubeId } from '../links/detect'

export interface Embed {
  src: string
  /** Pixel height, or 'video' for a 200px-tall video player. */
  height: number | 'video'
  allow: string
  sandbox?: string
}

type EmbeddableLink = Pick<LocalRecordingLink, 'provider' | 'provider_ref' | 'url'>

const SPOTIFY_REF = /^(track|album|episode|playlist):([A-Za-z0-9]+)$/
const TIDAL_REF = /^(track|album|playlist|video):([0-9A-Fa-f-]+)$/
const BANDCAMP_REF = /^(album|track):(\d+)$/
const ARCHIVE_REF = /^[A-Za-z0-9._-]+$/
const SOUNDCLOUD_HOST = /^(?:www\.|m\.)?soundcloud\.com$/

const BASIC_ALLOW = 'autoplay; encrypted-media'
const YOUTUBE_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
const SPOTIFY_ALLOW = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
const APPLE_ALLOW = 'autoplay *; encrypted-media *'
const APPLE_SANDBOX =
  'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation'
const TIDAL_ALLOW =
  'autoplay; encrypted-media; fullscreen; clipboard-write https://embed.tidal.com; web-share'
const TIDAL_SANDBOX =
  'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
const ARCHIVE_ALLOW = 'autoplay; encrypted-media; fullscreen'

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** The in-app player for a link, or null when the link can only open elsewhere. */
export function embedFor(link: EmbeddableLink, options?: { autoplay?: boolean }): Embed | null {
  const ref = link.provider_ref ?? ''
  const autoplay = options?.autoplay ?? false
  switch (link.provider) {
    case 'youtube': {
      const id = youtubeId(link)
      if (!id) return null
      return {
        src: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1${autoplay ? '&autoplay=1' : ''}`,
        height: 'video',
        allow: YOUTUBE_ALLOW,
      }
    }
    case 'spotify': {
      const match = SPOTIFY_REF.exec(ref)
      if (!match) return null
      const [, kind, id] = match
      return {
        src: `https://open.spotify.com/embed/${kind}/${id}`,
        height: 152,
        allow: SPOTIFY_ALLOW,
      }
    }
    case 'apple_music': {
      const url = parseUrl(link.url)
      if (!url || url.hostname !== 'music.apple.com') return null
      url.protocol = 'https:'
      url.hostname = 'embed.music.apple.com'
      return {
        src: url.toString(),
        height: 175,
        allow: APPLE_ALLOW,
        sandbox: APPLE_SANDBOX,
      }
    }
    case 'tidal': {
      const match = TIDAL_REF.exec(ref)
      if (!match) return null
      const [, kind, id] = match
      return {
        src: `https://embed.tidal.com/${kind}s/${id}`,
        height: kind === 'track' ? 120 : kind === 'video' ? 'video' : 150,
        allow: TIDAL_ALLOW,
        sandbox: TIDAL_SANDBOX,
      }
    }
    case 'soundcloud': {
      const url = parseUrl(link.url)
      if (!url || !SOUNDCLOUD_HOST.test(url.hostname)) return null
      return {
        src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(link.url)}${autoplay ? '&auto_play=true' : ''}`,
        height: 166,
        allow: BASIC_ALLOW,
      }
    }
    case 'bandcamp': {
      const match = BANDCAMP_REF.exec(ref)
      if (!match) return null
      const [, kind, id] = match
      return {
        src: `https://bandcamp.com/EmbeddedPlayer/${kind}=${id}/size=large/artwork=small/tracklist=false/transparent=true/`,
        height: 120,
        allow: BASIC_ALLOW,
      }
    }
    case 'internet_archive': {
      if (!ARCHIVE_REF.test(ref)) return null
      return { src: `https://archive.org/embed/${ref}`, height: 60, allow: ARCHIVE_ALLOW }
    }
    default:
      return null
  }
}
