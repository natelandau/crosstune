import { describe, expect, it } from 'vitest'
import { detectProvider, youtubeId } from './detect'

const SH = 'https://www.slippery-hill.com'
const GLAD = '78s/15402%20What%20A%20Glad%20Day%20%20%28Wright%20Brothers%20Quartet%29.mp3'
// The longest ref a link row stores, and one character past it.
const LONGEST_REF = `${'a'.repeat(196)}.mp3`
const OVERLONG_REF = `${'a'.repeat(197)}.mp3`
// new URL() collapses dot segments before detection sees the path, so those rows end in the
// ref of the path the browser would actually request.
const SLIPPERY_HILL_ROWS: [string, string, string | null][] = [
  [`${SH}/content/bear-creek-sally-goodin?x=1#a`, 'slippery_hill', null],
  ['https://slippery-hill.com/content/june-apple-2/', 'slippery_hill', null],
  [
    `${SH}/system/files/recordings/bearcreeksallygoodin_bobholt.mp3`,
    'slippery_hill',
    'recordings/bearcreeksallygoodin_bobholt.mp3',
  ],
  [`https://slippery-hill.com/system/files/${GLAD}`, 'slippery_hill', GLAD],
  [`${SH}/system/files/recordings/a.MP3`, 'slippery_hill', 'recordings/a.MP3'],
  [`${SH}/system/files/../x.mp3`, 'slippery_hill', null],
  [`${SH}/system/files/a/%2E%2e/x.mp3`, 'slippery_hill', 'x.mp3'],
  [`${SH}/system/files/a/./x.mp3`, 'slippery_hill', 'a/x.mp3'],
  [`${SH}/system/files/a:b.mp3`, 'slippery_hill', null],
  [`${SH}/system/files/a@b/x.mp3`, 'slippery_hill', null],
  [`${SH}/system/files/\u00e9.mp3`, 'slippery_hill', '%C3%A9.mp3'],
  [`${SH}/system/files/a/b%2Ec.mp3`, 'slippery_hill', null],
  [`${SH}/system/files/x%2E.mp3`, 'slippery_hill', null],
  [`${SH}/system/files/a.wav`, 'slippery_hill', null],
  [`${SH}/system/files/${LONGEST_REF}`, 'slippery_hill', LONGEST_REF],
  [`${SH}/system/files/${OVERLONG_REF}`, 'slippery_hill', null],
  [`${SH}/tune-search?search_api_fulltext=x`, 'slippery_hill', null],
]

describe('detectProvider', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'youtube', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
    [
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      'spotify',
      'track:4uLU6hMCjMI75M1A2tKUQC',
    ],
    ['https://open.spotify.com/intl-de/album/1A2B', 'spotify', 'album:1A2B'],
    ['https://music.apple.com/us/album/x/123?i=456', 'apple_music', '456'],
    ['https://music.apple.com/us/album/x/123', 'apple_music', '123'],
    ['https://someone.bandcamp.com/track/y', 'bandcamp', null],
    ['https://soundcloud.com/a/b', 'soundcloud', null],
    ['https://tidal.com/track/45670321/u', 'tidal', 'track:45670321'],
    ['https://tidal.com/browse/album/45670320', 'tidal', 'album:45670320'],
    ['https://listen.tidal.com/album/45670320/track/45670321', 'tidal', 'track:45670321'],
    [
      'https://tidal.com/playlist/748d84d2-37dc-4900-9bc5-68d8ac89d354',
      'tidal',
      'playlist:748d84d2-37dc-4900-9bc5-68d8ac89d354',
    ],
    ['https://tidal.com/video/97770920', 'tidal', 'video:97770920'],
    ['https://tidal.com/artist/4831953', 'tidal', null],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x', 'youtube', 'dQw4w9WgXcQ'],
    [
      'https://archive.org/details/78_soldiers-joy_sleepy-marlin_gbia0506187b',
      'internet_archive',
      '78_soldiers-joy_sleepy-marlin_gbia0506187b',
    ],
    [
      'https://archive.org/details/afc1937001_1535B2/track01.mp3',
      'internet_archive',
      'afc1937001_1535B2',
    ],
    ['https://archive.org/search?query=fiddle', 'internet_archive', null],
    ['https://example.com/tune.mp3', 'other', null],
    ['not a url', 'other', null],
    ...SLIPPERY_HILL_ROWS,
  ])('%s -> %s %s', (url, provider, ref) => {
    expect(detectProvider(url)).toEqual({ provider, provider_ref: ref })
  })

  it('extracts a playable youtube id only for youtube links', () => {
    expect(youtubeId({ provider: 'youtube', provider_ref: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(youtubeId({ provider: 'spotify', provider_ref: 'track:x' })).toBeNull()
  })
})
