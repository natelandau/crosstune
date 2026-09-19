import type { RecordingFile } from '../db/recordings'
import type { LocalRecording, LocalRecordingLink, LocalSong, LocalUserSong } from '../db/types'

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

export function linkRow(
  id: string,
  songId: string,
  extra: Partial<LocalRecordingLink> = {},
): LocalRecordingLink {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    song_id: songId,
    url: 'https://example.com/x',
    provider: 'other',
    provider_ref: null,
    title: null,
    artwork_url: null,
    label: null,
    position: 0,
    ...extra,
  }
}

export function recordingRow(id: string, extra: Partial<LocalRecording> = {}): LocalRecording {
  return {
    id,
    created_at: 't',
    updated_at: 't',
    deleted_at: null,
    server_seq: 0,
    song_id: null,
    label: null,
    source: 'microphone',
    recorded_at: '2026-01-01T12:00:00.000Z',
    position: 0,
    state: 'ready',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    ...extra,
  }
}

export function recordingFile(id: string, extra: Partial<RecordingFile> = {}): RecordingFile {
  return {
    id,
    blob: null,
    mime: null,
    bytes: 0,
    local_duration_ms: null,
    local_state: 'captured',
    error: null,
    last_chunk_at: null,
    song_id: null,
    recorded_at: null,
    next_attempt_at: null,
    upload_attempts: 0,
    ...extra,
  }
}
