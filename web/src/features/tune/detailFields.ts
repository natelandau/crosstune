import { TIME_SIGNATURES, TUNE_LIMITS } from '../../api/vocabulary'
import { GENRES, PART_STRUCTURES, TUNE_TYPES } from '../../constants'
import { TRAD } from './tuneTypes'

export type DetailField =
  | {
      kind: 'text'
      key: 'alternate_titles' | 'learned_from'
      label: string
      maxLength?: number
    }
  | {
      kind: 'pick'
      key: 'composer' | 'genre' | 'time_signature' | 'tune_type' | 'part_structure'
      label: string
      options: readonly string[]
      other: boolean
      maxLength?: number
    }
  | { kind: 'modes'; key: 'modes'; label: string }
  | { kind: 'switch'; key: 'is_crooked'; label: string; help?: string }
  | { kind: 'lyrics'; key: 'lyrics'; label: string }
  | { kind: 'date'; key: 'learned_on'; label: string }

/** What each detail field is called, on the tune form and in the bulk edit sheet alike. */
export const DETAIL_LABELS = {
  alternate_titles: 'Also known as',
  composer: 'Composer',
  mode: 'Mode',
  genre: 'Genre',
  time_signature: 'Time signature',
  tune_type: 'Type',
  part_structure: 'Parts',
  is_crooked: 'Crooked',
  lyrics: 'Lyrics',
  learned_from: 'Learned from',
  learned_on: 'Learned on',
} as const

/** Each part's mode row, in part order. The first covers the whole tune when it has one mode. */
export const PART_MODE_LABELS = ['Mode', 'B part mode', 'C part mode', 'D part mode'] as const

export const ADD_PART_MODE = 'Add mode for another part'

export const CROOKED_HELP = 'An odd number of beats or bars in a part.'

/** The Details card's own footer. The rule governs one field but belongs to the card, because
 *  help text inside a card reads as another row. */
export const DETAILS_FOOTER = 'Separate alternate names with commas.'

/** The fields a player touches rarely, in the order they read down the Details list. */
export const DETAIL_FIELDS: readonly DetailField[] = [
  {
    kind: 'text',
    key: 'alternate_titles',
    label: DETAIL_LABELS.alternate_titles,
  },
  // The form swaps in the catalog's composers.
  {
    kind: 'pick',
    key: 'composer',
    label: DETAIL_LABELS.composer,
    options: [TRAD],
    other: true,
    maxLength: TUNE_LIMITS.composer,
  },
  { kind: 'modes', key: 'modes', label: DETAIL_LABELS.mode },
  {
    kind: 'pick',
    key: 'genre',
    label: DETAIL_LABELS.genre,
    options: GENRES,
    other: true,
    maxLength: TUNE_LIMITS.genre,
  },
  // The form swaps in the types ordered for the tune's genre.
  {
    kind: 'pick',
    key: 'tune_type',
    label: DETAIL_LABELS.tune_type,
    options: TUNE_TYPES,
    other: true,
    maxLength: TUNE_LIMITS.tune_type,
  },
  {
    kind: 'pick',
    key: 'time_signature',
    label: DETAIL_LABELS.time_signature,
    options: TIME_SIGNATURES,
    other: false,
  },
  {
    kind: 'pick',
    key: 'part_structure',
    label: DETAIL_LABELS.part_structure,
    options: PART_STRUCTURES,
    other: true,
    maxLength: TUNE_LIMITS.part_structure,
  },
  {
    kind: 'switch',
    key: 'is_crooked',
    label: DETAIL_LABELS.is_crooked,
    help: CROOKED_HELP,
  },
  { kind: 'lyrics', key: 'lyrics', label: DETAIL_LABELS.lyrics },
  {
    kind: 'text',
    key: 'learned_from',
    label: DETAIL_LABELS.learned_from,
    maxLength: TUNE_LIMITS.learned_from,
  },
  { kind: 'date', key: 'learned_on', label: DETAIL_LABELS.learned_on },
]
