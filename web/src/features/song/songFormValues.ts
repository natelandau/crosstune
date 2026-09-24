import {
  MODES,
  TIME_SIGNATURES,
  type Mode,
  type TuneStatus,
  type TimeSignature,
} from '../../api/vocabulary'
import type { SongInput, UserSongInput } from '../../commands/songs'
import type { LocalSong, LocalUserSong } from '../../db/types'
import { isSongStatus } from '../catalog/status'

export interface SongFormValues {
  title: string
  alternate_titles: string
  key: string
  mode: Mode | ''
  /** The row's raw stored mode, kept only until the player picks or clears one, so a value
   *  this client predates survives a save that never touches the field. */
  mode_raw: string | null
  violin_tuning: string
  banjo_tuning: string
  genre: string
  feel: string
  part_structure: string
  time_signature: TimeSignature | ''
  /** The row's raw stored time signature, kept only until the player picks or clears one, so a
   *  value this client predates survives a save that never touches the field. */
  time_signature_raw: string | null
  is_crooked: boolean
  lyrics: string
  status: TuneStatus
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
    mode_raw: null,
    violin_tuning: '',
    banjo_tuning: '',
    genre: '',
    feel: '',
    part_structure: '',
    time_signature: '4/4',
    time_signature_raw: null,
    is_crooked: false,
    lyrics: '',
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
    mode_raw: song.mode ?? null,
    violin_tuning: song.violin_tuning ?? '',
    banjo_tuning: song.banjo_tuning ?? '',
    genre: song.genre ?? '',
    feel: song.feel ?? '',
    part_structure: song.part_structure ?? '',
    time_signature: asTimeSignature(song.time_signature),
    time_signature_raw: song.time_signature ?? null,
    is_crooked: song.is_crooked,
    lyrics: song.lyrics ?? '',
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
      // A raw fallback may hold a value from a schema version this client predates; write it
      // through untyped, the same as a pulled row carries it locally.
      mode: (values.mode || values.mode_raw) as Mode | null,
      violin_tuning: blankToNull(values.violin_tuning),
      banjo_tuning: blankToNull(values.banjo_tuning),
      genre: blankToNull(values.genre),
      feel: blankToNull(values.feel),
      part_structure: blankToNull(values.part_structure),
      time_signature: (values.time_signature || values.time_signature_raw) as TimeSignature | null,
      is_crooked: values.is_crooked,
      lyrics: blankToNull(values.lyrics),
    },
    userSong: {
      status: values.status,
      learned_from: blankToNull(values.learned_from),
      learned_on: values.learned_on || null,
      notes: blankToNull(values.notes),
    },
  }
}
