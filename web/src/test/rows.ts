import type { NotationFile } from '../db/notation'
import type { RecordingFile } from '../db/recordings'
import type {
  LocalRecording,
  LocalRecordingLink,
  LocalNotationPage,
  LocalRecordingLoop,
  LocalTune,
  LocalUserTune,
} from '../db/types'

export function tuneRow(id: string, title: string, extra: Partial<LocalTune> = {}): LocalTune {
  return {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    title,
    alternate_titles: [],
    genre: null,
    tune_type: null,
    modes: [],
    composer: null,
    lyrics: null,
    key: null,
    tunings: {},
    part_structure: null,
    time_signature: null,
    is_crooked: false,
    ...extra,
  }
}

export function userTuneRow(
  id: string,
  tuneId: string,
  extra: Partial<LocalUserTune> = {},
): LocalUserTune {
  return {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    tune_id: tuneId,
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
  tuneId: string,
  extra: Partial<LocalRecordingLink> = {},
): LocalRecordingLink {
  return {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    tune_id: tuneId,
    url: 'https://example.com/x',
    provider: 'other',
    provider_ref: null,
    title: null,
    artwork_url: null,
    position: 0,
    ...extra,
  }
}

export function recordingRow(id: string, extra: Partial<LocalRecording> = {}): LocalRecording {
  return {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    tune_id: null,
    label: null,
    source: 'microphone',
    origin: 'own',
    origin_url: null,
    recorded_at: '2026-01-01T12:00:00.000Z',
    position: 0,
    state: 'ready',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    trim_start_ms: 0,
    trim_end_ms: null,
    speed_percent: 100,
    pitch_cents: 0,
    source_duration_ms: null,
    playback_start_ms: null,
    playback_end_ms: null,
    playback_rev: null,
    peaks_rev: null,
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
    blob_rev: null,
    blob_start_ms: 0,
    peaks: null,
    peaks_rev: null,
    last_chunk_at: null,
    tune_id: null,
    recorded_at: null,
    next_attempt_at: null,
    upload_attempts: 0,
    ...extra,
  }
}

export function loopRow(overrides: Partial<LocalRecordingLoop> = {}): LocalRecordingLoop {
  return {
    id: 'loop-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 0,
    recording_id: 'rec-1',
    label: null,
    start_ms: 1000,
    end_ms: 3000,
    color: 0,
    ...overrides,
  }
}

export function notationPageRow(
  id: string,
  tuneId: string,
  extra: Partial<LocalNotationPage> = {},
): LocalNotationPage {
  return {
    id,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    server_seq: 1,
    tune_id: tuneId,
    position: 0,
    width: 600,
    height: 800,
    state: 'ready',
    file_bytes: 1000,
    ...extra,
  }
}

export function notationFile(
  id: string,
  blob: Blob,
  extra: Partial<NotationFile> = {},
): NotationFile {
  return {
    id,
    blob,
    origin: 'downloaded',
    error: null,
    next_attempt_at: null,
    upload_attempts: 0,
    ...extra,
  }
}

/** A real JPEG the browser can decode, in one flat color. */
export async function jpegBlob(width: number, height: number, color = '#222'): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  return canvas.convertToBlob({ type: 'image/jpeg' })
}
