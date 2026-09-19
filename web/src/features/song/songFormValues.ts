import type { SongInput, UserSongInput } from '../../commands/songs'
import {
  MODES,
  TIME_SIGNATURES,
  type LocalSong,
  type LocalUserSong,
  type Mode,
  type SongStatus,
  type TimeSignature,
} from '../../db/types'
import { isSongStatus } from '../catalog/status'

export interface SongFormValues {
  title: string
  alternate_titles: string
  key: string
  mode: Mode | ''
  violin_tuning: string
  banjo_tuning: string
  genre: string
  feel: string
  part_structure: string
  time_signature: TimeSignature | ''
  is_crooked: boolean
  has_lyrics: boolean
  status: SongStatus
  learned_from: string
  learned_on: string
  notes: string
}

export function emptyValues(): SongFormValues {
  return {
    title: '',
    alternate_titles: '',
    key: '',
    mode: '',
    violin_tuning: '',
    banjo_tuning: '',
    genre: '',
    feel: '',
    part_structure: '',
    time_signature: '4/4',
    is_crooked: false,
    has_lyrics: false,
    status: 'want_to_learn',
    learned_from: '',
    learned_on: '',
    notes: '',
  }
}

// A server row can carry a facet value from a schema version this client predates;
// fall back rather than trust it as one of this client's known options.
export const asMode = (value: string | null | undefined): Mode | '' =>
  (MODES as readonly string[]).includes(value ?? '') ? (value as Mode) : ''

export const asTimeSignature = (value: string | null | undefined): TimeSignature | '' =>
  (TIME_SIGNATURES as readonly string[]).includes(value ?? '') ? (value as TimeSignature) : ''

export function valuesFromRows(song: LocalSong, userSong: LocalUserSong): SongFormValues {
  return {
    title: song.title,
    alternate_titles: song.alternate_titles.join(', '),
    key: song.key ?? '',
    mode: asMode(song.mode),
    violin_tuning: song.violin_tuning ?? '',
    banjo_tuning: song.banjo_tuning ?? '',
    genre: song.genre ?? '',
    feel: song.feel ?? '',
    part_structure: song.part_structure ?? '',
    time_signature: asTimeSignature(song.time_signature),
    is_crooked: song.is_crooked,
    has_lyrics: song.has_lyrics ?? false,
    status: isSongStatus(userSong.status) ? userSong.status : 'want_to_learn',
    learned_from: userSong.learned_from ?? '',
    learned_on: userSong.learned_on ?? '',
    notes: userSong.notes ?? '',
  }
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null)

export function inputsFromValues(values: SongFormValues): {
  song: SongInput
  userSong: UserSongInput
} {
  return {
    song: {
      title: values.title.trim(),
      alternate_titles: values.alternate_titles
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      key: blankToNull(values.key),
      mode: values.mode || null,
      violin_tuning: blankToNull(values.violin_tuning),
      banjo_tuning: blankToNull(values.banjo_tuning),
      genre: blankToNull(values.genre),
      feel: blankToNull(values.feel),
      part_structure: blankToNull(values.part_structure),
      time_signature: values.time_signature || null,
      is_crooked: values.is_crooked,
      has_lyrics: values.has_lyrics,
    },
    userSong: {
      status: values.status,
      learned_from: blankToNull(values.learned_from),
      learned_on: values.learned_on || null,
      notes: blankToNull(values.notes),
    },
  }
}
