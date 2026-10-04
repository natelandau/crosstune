import { describe, expect, it } from 'vitest'
import { embedFor } from './embed'

function link(provider: string, provider_ref: string | null, url = 'https://example.com/x') {
  return { provider, provider_ref, url }
}

describe('embedFor', () => {
  it.each([
    [
      'youtube',
      link('youtube', 'dQw4w9WgXcQ'),
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1',
      'video',
      'frame',
    ],
    [
      'spotify track',
      link('spotify', 'track:403iATVGis7FqKA0BcTSRt'),
      'https://open.spotify.com/embed/track/403iATVGis7FqKA0BcTSRt',
      152,
      'frame',
    ],
    [
      'spotify episode',
      link('spotify', 'episode:4rOoJ6Egrf8K2IrywzwOMk'),
      'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk',
      152,
      'frame',
    ],
    [
      'spotify album',
      link('spotify', 'album:1DFixLWuPkv3KT3TnV35m3'),
      'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3',
      152,
      'frame',
    ],
    [
      'spotify playlist',
      link('spotify', 'playlist:37i9dQZF1DXcBWIGoYBM5M'),
      'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
      152,
      'frame',
    ],
    [
      'apple music tune',
      link(
        'apple_music',
        '148243927',
        'https://music.apple.com/us/album/roaring-river/148243382?i=148243927',
      ),
      'https://embed.music.apple.com/us/album/roaring-river/148243382?i=148243927',
      175,
      'frame',
    ],
    [
      'apple music song path',
      link('apple_music', null, 'https://music.apple.com/us/song/roaring-river/148243927'),
      'https://embed.music.apple.com/us/song/roaring-river/148243927',
      175,
      'frame',
    ],
    [
      'apple music album',
      link('apple_music', '148243382', 'https://music.apple.com/us/album/roaring-river/148243382'),
      'https://embed.music.apple.com/us/album/roaring-river/148243382',
      175,
      'frame',
    ],
    [
      'apple music over http',
      link('apple_music', null, 'http://music.apple.com/us/song/roaring-river/148243927'),
      'https://embed.music.apple.com/us/song/roaring-river/148243927',
      175,
      'frame',
    ],
    [
      'tidal track',
      link('tidal', 'track:45670321'),
      'https://embed.tidal.com/tracks/45670321',
      120,
      'frame',
    ],
    [
      'tidal album',
      link('tidal', 'album:45670320'),
      'https://embed.tidal.com/albums/45670320',
      150,
      'frame',
    ],
    [
      'tidal playlist',
      link('tidal', 'playlist:748d84d2-37dc-4900-9bc5-68d8ac89d354'),
      'https://embed.tidal.com/playlists/748d84d2-37dc-4900-9bc5-68d8ac89d354',
      150,
      'frame',
    ],
    [
      'tidal video',
      link('tidal', 'video:97770920'),
      'https://embed.tidal.com/videos/97770920',
      'video',
      'frame',
    ],
    [
      'soundcloud track',
      link('soundcloud', null, 'https://soundcloud.com/someone/some-tune'),
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune',
      166,
      'frame',
    ],
    [
      'soundcloud set',
      link('soundcloud', null, 'https://soundcloud.com/someone/sets/jam'),
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsets%2Fjam',
      166,
      'frame',
    ],
    [
      'bandcamp album',
      link('bandcamp', 'album:84352595'),
      'https://bandcamp.com/EmbeddedPlayer/album=84352595/size=large/artwork=small/tracklist=false/transparent=true/',
      120,
      'frame',
    ],
    [
      'bandcamp track',
      link('bandcamp', 'track:2417374'),
      'https://bandcamp.com/EmbeddedPlayer/track=2417374/size=large/artwork=small/tracklist=false/transparent=true/',
      120,
      'frame',
    ],
    [
      'internet archive',
      link('internet_archive', '78_soldiers-joy_sleepy-marlin_gbia0506187b'),
      'https://archive.org/embed/78_soldiers-joy_sleepy-marlin_gbia0506187b',
      60,
      'frame',
    ],
    [
      'slippery hill',
      link('slippery_hill', 'recordings/a.mp3'),
      'https://www.slippery-hill.com/system/files/recordings/a.mp3',
      60,
      'audio',
    ],
  ])('builds the %s player', (_name, input, src, height, kind) => {
    const embed = embedFor(input)
    expect(embed?.src).toBe(src)
    expect(embed?.height).toBe(height)
    expect(embed?.allow).toContain('autoplay')
    if (kind === 'frame') expect(embed?.allow).toContain('encrypted-media')
    expect(embed?.kind).toBe(kind)
  })

  it('adds autoplay to the youtube src only when requested', () => {
    const input = link('youtube', 'dQw4w9WgXcQ')
    expect(embedFor(input)?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1',
    )
    expect(embedFor(input, { autoplay: true })?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&autoplay=1',
    )
  })

  it('adds auto_play to the soundcloud src only when requested', () => {
    const input = link('soundcloud', null, 'https://soundcloud.com/someone/some-tune')
    expect(embedFor(input)?.src).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune',
    )
    expect(embedFor(input, { autoplay: true })?.src).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fsome-tune&auto_play=true',
    )
  })

  it('sandboxes the apple music and tidal players as their own embed code does', () => {
    expect(
      embedFor(link('apple_music', '1', 'https://music.apple.com/us/album/x/1?i=2'))?.sandbox,
    ).toBe(
      'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation',
    )
    expect(embedFor(link('tidal', 'track:1'))?.sandbox).toBe(
      'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
    )
    expect(embedFor(link('spotify', 'track:1'))?.sandbox).toBeUndefined()
  })

  it.each([
    ['youtube without a valid id', link('youtube', 'short')],
    ['spotify without a ref', link('spotify', null)],
    ['apple music on another host', link('apple_music', '1', 'https://example.com/album/1')],
    ['apple music with an unparsable url', link('apple_music', '1', 'not a url')],
    ['tidal without a ref', link('tidal', null)],
    ['tidal artist ref', link('tidal', 'artist:1')],
    ['soundcloud on another host', link('soundcloud', null, 'https://example.com/a/b')],
    ['soundcloud with an unparsable url', link('soundcloud', null, 'not a url')],
    ['bandcamp before resolution', link('bandcamp', null)],
    ['internet archive without a ref', link('internet_archive', null)],
    ['slippery hill without a ref', link('slippery_hill', null)],
    ['slippery hill with a dot segment', link('slippery_hill', '../x.mp3')],
    ['slippery hill with a current-dir segment', link('slippery_hill', 'a/./x.mp3')],
    ['slippery hill with an encoded dot segment', link('slippery_hill', 'a/%2E%2E/x.mp3')],
    ['other', link('other', null)],
    ['a provider this client predates', link('napster', 'track:1')],
  ])('has no player for %s', (_name, input) => {
    expect(embedFor(input)).toBeNull()
  })
})
