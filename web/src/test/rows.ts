import type { LocalSong, LocalUserSong } from '../db/types'

export function songRow(id: string, title: string, extra: Partial<LocalSong> = {}): LocalSong {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    title,
    alternate_titles: [],
    genre: null,
    feel: null,
    has_lyrics: null,
    key: null,
    mode: null,
    violin_tuning: null,
    banjo_tuning: null,
    part_structure: null,
    time_signature: null,
    is_crooked: false,
    ...extra,
  }
}

export function userSongRow(
  id: string,
  songId: string,
  extra: Partial<LocalUserSong> = {},
): LocalUserSong {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    song_id: songId,
    status: 'known',
    learned_from: null,
    learned_on: null,
    notes: null,
    archived_at: null,
    ...extra,
  }
}
