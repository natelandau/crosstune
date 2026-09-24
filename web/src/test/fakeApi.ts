import { ApiError, TransferError } from '../api/client'
import type {
  Change,
  ChangeResult,
  PullResponse,
  RecordingRow,
  SongRow,
  SyncApi,
  TableName,
  UserSongRow,
} from '../api/types'

type PushResponder = (changes: Change[]) => ChangeResult[] | Promise<ChangeResult[]>

// The column the server fills from the token; list items inherit ownership from their list.
const OWNER_COLUMN: Record<TableName, string | null> = {
  songs: 'owner_user_id',
  user_songs: 'user_id',
  lists: 'user_id',
  list_items: null,
  recording_links: 'added_by_user_id',
  recordings: 'user_id',
  user_settings: 'user_id',
}

export function createFakeApi() {
  const pushes: Change[][] = []
  const pulls: number[] = []
  const pullQueue: PullResponse[] = []
  let failWith: unknown = null
  let serverSeq = 0
  const objects = new Map<string, Blob>()
  const recordingStates = new Map<
    string,
    'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed'
  >()
  let storage = { used_bytes: 0, quota_bytes: 1_073_741_824, max_file_bytes: 52_428_800 }
  let slotError: unknown = null
  let slotErrorId: string | null = null
  let confirmError: unknown = null
  let putError: unknown = null
  let putErrorId: string | null = null

  /** Echo a pushed change back the way the server does, so the store path runs in tests. */
  function appliedRow(change: Change): Record<string, unknown> {
    serverSeq++
    const owner = OWNER_COLUMN[change.table]
    return {
      ...change.data,
      ...(change.table === 'recordings'
        ? {
            state: 'pending_upload',
            duration_ms: null,
            playback_mime: null,
            playback_bytes: null,
            error: null,
          }
        : {}),
      id: change.id,
      created_at: change.updated_at,
      updated_at: change.updated_at,
      deleted_at: change.op === 'delete' ? change.updated_at : null,
      server_seq: serverSeq,
      ...(owner ? { [owner]: 'server-user' } : {}),
    }
  }

  let respond: PushResponder = (changes) =>
    changes.map(
      (c) => ({ table: c.table, id: c.id, status: 'applied', row: appliedRow(c) }) as ChangeResult,
    )

  const api: SyncApi = {
    async push(changes) {
      if (failWith) throw failWith
      pushes.push(changes)
      return { results: await respond(changes) }
    },
    async pull(since) {
      if (failWith) throw failWith
      pulls.push(since)
      return pullQueue.shift() ?? { rows: [], next_since: since, has_more: false }
    },
    async resolveLink(url) {
      if (failWith) throw failWith
      return { url, provider: 'other', provider_ref: null, title: 'Resolved', artwork_url: null }
    },
    async me() {
      if (failWith) throw failWith
      return {
        id: 'server-user',
        clerk_user_id: 'user_1',
        email: null,
        created_at: '2026-09-11T00:00:00Z',
        storage,
      }
    },
    async requestUploadSlot(recordingId, body) {
      if (failWith) throw failWith
      if (slotError && (slotErrorId === null || slotErrorId === recordingId)) throw slotError
      const state = recordingStates.get(recordingId) ?? 'pending_upload'
      if (state !== 'pending_upload' && state !== 'failed') {
        throw new ApiError(409, {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: state,
        })
      }
      recordingStates.set(recordingId, 'pending_upload')
      return {
        url: `https://fake.r2/${recordingId}/upload?ct=${body.content_type}`,
        expires_at: '2999-01-01T00:00:00Z',
      }
    },
    async uploadFinished(recordingId) {
      if (failWith) throw failWith
      if (confirmError) {
        const error = confirmError
        confirmError = null
        throw error
      }
      if (!objects.has(`${recordingId}/upload`)) throw new ApiError(409, null)
      recordingStates.set(recordingId, 'uploaded')
    },
    async retryRecording(recordingId) {
      if (failWith) throw failWith
      if (recordingStates.get(recordingId) !== 'failed') throw new ApiError(409, null)
      recordingStates.set(recordingId, 'uploaded')
    },
    async downloadUrl(recordingId) {
      if (failWith) throw failWith
      if (recordingStates.get(recordingId) !== 'ready') throw new ApiError(409, null)
      return {
        url: `https://fake.r2/${recordingId}/playback.m4a`,
        expires_at: '2999-01-01T00:00:00Z',
      }
    },
    async putObject(url, blob) {
      if (failWith) throw failWith
      const key = new URL(url).pathname.slice(1)
      const recordingId = key.split('/')[0]
      if (putError && (putErrorId === null || putErrorId === recordingId)) throw putError
      objects.set(key, blob)
    },
    async getObject(url) {
      if (failWith) throw failWith
      const blob = objects.get(new URL(url).pathname.slice(1))
      if (!blob) throw new TransferError(404)
      return blob
    },
  }

  return {
    api,
    pushes,
    pulls,
    objects,
    recordingStates,
    respondToPush(fn: PushResponder) {
      respond = fn
    },
    queuePull(...pages: PullResponse[]) {
      pullQueue.push(...pages)
    },
    fail(error: unknown) {
      failWith = error
    },
    setStorage(next: typeof storage) {
      storage = next
    },
    /** With no id, every slot request fails; with one, only that recording's does. */
    failSlot(error: unknown, recordingId: string | null = null) {
      slotError = error
      slotErrorId = recordingId
    },
    /** Throws once from the next uploadFinished call, then behaves normally again. */
    failConfirm(error: unknown) {
      confirmError = error
    },
    /** With no id, every object PUT fails; with one, only that recording's does. */
    failPut(error: unknown, recordingId: string | null = null) {
      putError = error
      putErrorId = recordingId
    },
  }
}

export function serverSong(overrides: Partial<SongRow> & { id: string }): SongRow {
  return {
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    deleted_at: null,
    server_seq: 1,
    owner_user_id: 'server-user',
    title: 'Server Song',
    alternate_titles: [],
    genre: null,
    feel: null,
    lyrics: null,
    key: null,
    mode: null,
    violin_tuning: null,
    banjo_tuning: null,
    part_structure: null,
    time_signature: null,
    is_crooked: false,
    tunings: {},
    ...overrides,
  }
}

export function serverUserSong(
  overrides: Partial<UserSongRow> & { id: string; song_id: string },
): UserSongRow {
  return {
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    deleted_at: null,
    server_seq: 2,
    user_id: 'server-user',
    status: 'known',
    learned_from: null,
    learned_on: null,
    notes: null,
    archived_at: null,
    ...overrides,
  }
}

export function serverRecording(overrides: Partial<RecordingRow> & { id: string }): RecordingRow {
  return {
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    deleted_at: null,
    server_seq: 3,
    user_id: 'server-user',
    song_id: null,
    label: null,
    source: 'microphone',
    recorded_at: '2026-09-11T00:00:00Z',
    position: 0,
    state: 'pending_upload',
    duration_ms: null,
    playback_mime: null,
    playback_bytes: null,
    error: null,
    ...overrides,
  }
}
