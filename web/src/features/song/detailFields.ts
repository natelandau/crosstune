import { MODES, TIME_SIGNATURES } from '../../db/types'
import { SONG_LIMITS } from './limits'
import { FEELS, GENRES, PART_STRUCTURES } from './suggestions'

export type DetailField =
  | {
      kind: 'text'
      key: 'alternate_titles' | 'learned_from'
      label: string
      help?: string
      maxLength?: number
    }
  | {
      kind: 'pick'
      key: 'mode' | 'genre' | 'time_signature' | 'feel' | 'part_structure'
      label: string
      options: readonly string[]
      other: boolean
      maxLength?: number
    }
  | { kind: 'switch'; key: 'is_crooked' | 'has_lyrics'; label: string; help?: string }
  | { kind: 'date'; key: 'learned_on'; label: string }

/** The fields a player touches rarely, in the order they read down the Details list. */
export const DETAIL_FIELDS: readonly DetailField[] = [
  {
    kind: 'text',
    key: 'alternate_titles',
    label: 'Also known as',
    help: 'Separate names with commas.',
  },
  { kind: 'pick', key: 'mode', label: 'Mode', options: MODES, other: false },
  {
    kind: 'pick',
    key: 'genre',
    label: 'Genre',
    options: GENRES,
    other: true,
    maxLength: SONG_LIMITS.genre,
  },
  {
    kind: 'pick',
    key: 'time_signature',
    label: 'Time signature',
    options: TIME_SIGNATURES,
    other: false,
  },
  {
    kind: 'pick',
    key: 'feel',
    label: 'Feel',
    options: FEELS,
    other: true,
    maxLength: SONG_LIMITS.feel,
  },
  {
    kind: 'pick',
    key: 'part_structure',
    label: 'Parts',
    options: PART_STRUCTURES,
    other: true,
    maxLength: SONG_LIMITS.part_structure,
  },
  {
    kind: 'switch',
    key: 'is_crooked',
    label: 'Crooked',
    help: 'An odd number of beats or bars in a part',
  },
  { kind: 'switch', key: 'has_lyrics', label: 'Has lyrics' },
  { kind: 'text', key: 'learned_from', label: 'Learned from', maxLength: SONG_LIMITS.learned_from },
  { kind: 'date', key: 'learned_on', label: 'Learned on' },
]
