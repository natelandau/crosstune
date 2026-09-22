/**
 * Every vocabulary the app offers a player and every limit it enforces, in one place.
 *
 * The lists and limits under "Mirrored by the server" are checked again by the API's row
 * schemas and database constraints, so a change there needs the same change in `api/`.
 * Everything below that line belongs to the client alone.
 */

// ---- Mirrored by the server ----------------------------------------------------------------

export const INSTRUMENTS = [
  'violin',
  'banjo',
  'guitar',
  'mandolin',
  'ukulele',
  'bass',
  'dulcimer',
  'accordion',
  'other',
] as const
export type Instrument = (typeof INSTRUMENTS)[number]

export const STATUSES = ['known', 'learning', 'want_to_learn'] as const
export type SongStatus = (typeof STATUSES)[number]

export const MODES = ['major', 'minor', 'mixolydian', 'dorian', 'other'] as const
export type Mode = (typeof MODES)[number]

export const TIME_SIGNATURES = ['4/4', '2/4', '2/2', '3/4', '6/8', '9/8', '12/8', 'other'] as const
export type TimeSignature = (typeof TIME_SIGNATURES)[number]

export const PROVIDERS = [
  'youtube',
  'spotify',
  'apple_music',
  'bandcamp',
  'soundcloud',
  'tidal',
  'internet_archive',
  'other',
] as const
export type Provider = (typeof PROVIDERS)[number]

export const AUDIO_QUALITIES = ['low', 'standard', 'high'] as const
export type AudioQuality = (typeof AUDIO_QUALITIES)[number]

// The server's row schema limits, so a long entry is stopped here instead of rejected on push.
export const SONG_LIMITS = {
  title: 200,
  key: 10,
  violin_tuning: 100,
  banjo_tuning: 100,
  genre: 100,
  feel: 100,
  part_structure: 100,
  learned_from: 200,
  lyrics: 20_000,
  notes: 20_000,
} as const

export const LIST_NAME_MAX_LENGTH = 200

export const LINK_LIMITS = {
  url: 2048,
  label: 200,
} as const

// ---- Instruments and tunings ---------------------------------------------------------------

// Stands in until the first-run prompt writes a row, and for a session that never syncs.
export const DEFAULT_INSTRUMENTS: ReadonlySet<Instrument> = new Set<Instrument>(['violin'])

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  violin: 'Violin',
  banjo: 'Banjo',
  guitar: 'Guitar',
  mandolin: 'Mandolin',
  ukulele: 'Ukulele',
  bass: 'Bass',
  dulcimer: 'Dulcimer',
  accordion: 'Accordion',
  other: 'Other',
}

/**
 * Each song tuning field, the instrument it belongs to, its label, and the shorter label a row
 * shows when a header above it already says Tuning. `label` stays the accessible name in both
 * places, so a row reading "Violin" is still announced as "Violin tuning".
 */
export const TUNING_FIELDS = {
  violin_tuning: { instrument: 'violin', label: 'Violin tuning', short: 'Violin' },
  banjo_tuning: { instrument: 'banjo', label: 'Banjo tuning', short: 'Banjo' },
} as const satisfies Record<string, { instrument: Instrument; label: string; short: string }>

export type TuningField = keyof typeof TUNING_FIELDS

export const TUNING_FIELD_NAMES = Object.keys(TUNING_FIELDS) as TuningField[]

export const VIOLIN_TUNINGS = [
  'Standard (GDAE)',
  'Cross A (AEAE)',
  'Cross G (GDGD)',
  'Calico (AEAC#)',
  'Dead Man (DDAD)',
]

export const BANJO_TUNINGS = [
  'Open G (gDGBD)',
  'Standard C (gCGBD)',
  'Double C (gCGCD)',
  'Sawmill (gDGCD)',
  'Double D (aDADE)',
]

export const TUNING_SUGGESTIONS: Record<TuningField, string[]> = {
  violin_tuning: VIOLIN_TUNINGS,
  banjo_tuning: BANJO_TUNINGS,
}

// ---- Keys ----------------------------------------------------------------------------------

/**
 * Every key spelling the client offers, alphabetical, with the sharp before the flat for each
 * letter. F sharp and G flat are one pitch but two keys, and musicians name them separately, so
 * both are listed; `pitchClass` reads them to the same hue, so they still color alike.
 */
export const ALL_KEYS = [
  'A',
  'A#',
  'Ab',
  'B',
  'Bb',
  'C',
  'C#',
  'D',
  'D#',
  'Db',
  'E',
  'Eb',
  'F',
  'F#',
  'G',
  'G#',
  'Gb',
] as const

/**
 * The keys on the grid, reachable in one tap. Everything else in ALL_KEYS costs a second tap
 * under More keys…, so this list is what a player reaches for without thinking. Edit it to
 * change the grid; nothing else needs to change.
 */
export const QUICK_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Bb', 'Eb'] as const

// ---- Song details --------------------------------------------------------------------------

export const GENRES = ['Old-time', 'Bluegrass', 'Irish', 'Cajun', 'Gospel', 'Blues', 'Swing']

export const FEELS = [
  'Breakdown',
  'Waltz',
  'Rag',
  'Jig',
  'Reel',
  'Hornpipe',
  'March',
  'Song',
  'Slow',
]

export const PART_STRUCTURES = ['AABB', 'AABBCC', 'AB', 'ABC', 'AAB', 'ABB']

// ---- Labels --------------------------------------------------------------------------------

export const STATUS_LABELS: Record<SongStatus, string> = {
  known: 'Known',
  learning: 'Learning',
  want_to_learn: 'Unknown',
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  bandcamp: 'Bandcamp',
  soundcloud: 'SoundCloud',
  tidal: 'TIDAL',
  internet_archive: 'Internet Archive',
  other: 'Link',
}

// ---- Recording -----------------------------------------------------------------------------

export const AUDIO_BITRATES: Record<AudioQuality, number> = {
  low: 48_000,
  standard: 64_000,
  high: 128_000,
}

export const AUDIO_QUALITY_NAMES: Record<AudioQuality, string> = {
  low: 'Low',
  standard: 'Standard',
  high: 'High',
}
