import { describe, expect, it } from 'vitest'
import { detectProvider, youtubeId } from './detect'

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
  ])('%s -> %s %s', (url, provider, ref) => {
    expect(detectProvider(url)).toEqual({ provider, provider_ref: ref })
  })

  it('extracts a playable youtube id only for youtube links', () => {
    expect(youtubeId({ provider: 'youtube', provider_ref: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ')
    expect(youtubeId({ provider: 'spotify', provider_ref: 'track:x' })).toBeNull()
  })
})
