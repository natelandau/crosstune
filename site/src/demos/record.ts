// The "Record it, or link it" demo's copy, timing, and links. The take is simulated: the site
// never opens the microphone.

export const TUNE_NAME = 'Bibb County Hoedown'
export const TAKE_SECONDS = 3
export const RECORD_LABEL = 'Record a take'
export const RECENT_TITLE = 'Recently added'
export const RECORD_REST = 'Your recordings and links, each filed under its tune.'
export const RECORD_PROMPT =
  'Tap record, or pick a link to play it here. Everything is filed under its tune.'
export const RECORDING = 'Recording…'
export const RECORD_SAVED = `Saved to ${TUNE_NAME}.`
export const BACK_TO_RECORDER = 'Back to the recorder'
export const takeSource = (seconds: number) =>
  `Your recording, just now, 0:${String(seconds).padStart(2, '0')}`

export const BAND_RECORDING = {
  tune: TUNE_NAME,
  source: 'Your recording, 0:30',
  src: '/audio/bibb-county-hoedown.m4a',
} as const
export const BAND_CAPTION = 'Your own recording plays from the phone, signal or not.'

export interface Link {
  provider: 'youtube' | 'spotify' | 'bandcamp'
  label: string
  tune: string
  /** The provider's own page, which a visitor without JavaScript opens. */
  href: string
  /** The provider's player, loaded only once a visitor picks the link. */
  embed: string
  /** The player's height in pixels; a video takes its width at 16:9 instead. */
  height?: number
}

export const LINKS: readonly Link[] = [
  {
    provider: 'youtube',
    label: 'YouTube',
    tune: 'Half Irish',
    href: 'https://www.youtube.com/watch?v=uLXDiMaMzEk',
    embed: 'https://www.youtube-nocookie.com/embed/uLXDiMaMzEk?autoplay=1',
  },
  {
    provider: 'spotify',
    label: 'Spotify',
    tune: "Amelia's Waltz",
    href: 'https://open.spotify.com/track/5HWWxXv2oaybqfW6Iz9Ssb',
    embed: 'https://open.spotify.com/embed/track/5HWWxXv2oaybqfW6Iz9Ssb',
    height: 352,
  },
  {
    provider: 'bandcamp',
    label: 'Bandcamp',
    tune: 'New Five Cent Piece',
    href: 'https://dollyandthedevil.bandcamp.com/track/new-five-cent-piece-deb-shebish-nancy-sluys-rick-davidson-joanne-davidson-robbie-dickerson',
    embed:
      'https://bandcamp.com/EmbeddedPlayer/track=3227275547/size=large/bgcol=ffffff/linkcol=4f5d75/artwork=small/transparent=true/',
    height: 120,
  },
]

export const linkCaption = (link: Link) => `${link.tune} plays right here, from ${link.label}.`
