/**
 * Everything the client owns outright: the vocabularies it suggests, the keys it offers, the
 * bitrates it records at, and the labels it shows. Anything here can be edited with no other
 * change to code, the API, or the database.
 *
 * The values the server validates are not here. They come from `api/src/crosstune/vocabulary.py`
 * through the contract, as `src/api/vocabulary.ts`; the label tables below are typed against
 * them, so a new server value fails the build until it has a label.
 */
import { TIME_SIGNATURES } from './api/vocabulary'
import type {
  AudioQuality,
  Instrument,
  Provider,
  TimeSignature,
  TuneStatus,
} from './api/vocabulary'
import type { TuningField } from './features/settings/instruments'

// ---- Instruments and tunings ---------------------------------------------------------------

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  violin: 'Violin',
  five_string_banjo: '5-string banjo',
  tenor_banjo: 'Tenor banjo',
  guitar: 'Guitar',
  mandolin: 'Mandolin',
  bouzouki: 'Bouzouki',
  mountain_dulcimer: 'Mountain dulcimer',
}

export const VIOLIN_TUNINGS = [
  'Standard (GDAE)',
  'Cross A (AEAE)',
  'Cross G (GDGD)',
  'High Bass (ADAE)',
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

/** Suggestions per instrument, name then strings, lowercase for a drone. The first is standard
 * when the instrument has one. */
export const TUNINGS: Record<Instrument, readonly string[]> = {
  violin: [
    'Standard (GDAE)',
    'Cross A (AEAE)',
    'Cross G (GDGD)',
    'High Bass (ADAE)',
    'Calico (AEAC#)',
    'Dead Man (DDAD)',
  ],
  five_string_banjo: [
    'Open G (gDGBD)',
    'Standard C (gCGBD)',
    'Double C (gCGCD)',
    'Sawmill (gDGCD)',
    'Double D (aDADE)',
  ],
  tenor_banjo: ['Irish (GDAE)', 'Standard (CGDA)'],
  guitar: ['Standard (EADGBE)', 'DADGAD', 'Drop D (DADGBE)', 'Open D (DADF#AD)', 'Open G (DGDGBD)'],
  mandolin: ['Standard (GDAE)', 'Cross A (AEAE)', 'Cross G (GDGD)'],
  bouzouki: ['GDAD', 'GDAE', 'ADAD', 'ADAE'],
  mountain_dulcimer: ['DAd', 'DAA', 'DAG', 'DAC'],
}

/** The tuning a row leaves unsaid. Only instruments whose standard every tradition shares. */
export const STANDARD_TUNINGS: Partial<Record<Instrument, string>> = {
  violin: 'Standard (GDAE)',
  five_string_banjo: 'Open G (gDGBD)',
  guitar: 'Standard (EADGBE)',
  mandolin: 'Standard (GDAE)',
}

/** Instruments that take a capo. constants.test.ts holds this to the API's FrettedTuning. */
export const CAPO_INSTRUMENTS: Record<Instrument, boolean> = {
  violin: false,
  five_string_banjo: true,
  tenor_banjo: true,
  guitar: true,
  mandolin: true,
  bouzouki: true,
  mountain_dulcimer: true,
}

export const CAPO_FRETS: readonly string[] = Array.from({ length: 12 }, (_, i) => String(i + 1))

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

// ---- Tune details --------------------------------------------------------------------------

export const GENRES = ['Old-time', 'Bluegrass', 'Irish', 'Cajun', 'Gospel', 'Blues', 'Swing']

export const FEELS = [
  'Breakdown',
  'Waltz',
  'Rag',
  'Jig',
  'Reel',
  'Hornpipe',
  'March',
  // A feel for a piece with words. Stored rows hold this exact string.
  'Song',
  'Slow',
]

export const PART_STRUCTURES = ['AABB', 'AABBCC', 'AB', 'ABC', 'AAB', 'ABB']

/**
 * Time signatures offered on the picker. TIME_SIGNATURES already carries 3/2 so a stored 3/2
 * value displays correctly, but it stays off this list until the API that accepts it is live
 * on both hosts: one tag deploys both sides in either order, and a client-first deploy or an
 * API rollback would otherwise refuse the edit and lose it.
 */
export const OFFERED_TIME_SIGNATURES: readonly TimeSignature[] = TIME_SIGNATURES.filter(
  (value) => value !== '3/2',
)

// ---- Labels --------------------------------------------------------------------------------

export const STATUS_LABELS: Record<TuneStatus, string> = {
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
