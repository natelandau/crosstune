import { ApiError, TransferError } from '../api/client'
import type {
  Change,
  ChangeResult,
  PullResponse,
  RecordingRow,
  TuneRow,
  SyncApi,
  TableName,
  UserTuneRow,
} from '../api/types'

function conflict(detail?: string): ApiError {
  return new ApiError(
    409,
    detail ? { type: 'about:blank', title: 'Conflict', status: 409, detail } : null,
  )
}

type PushResponder = (changes: Change[]) => ChangeResult[] | Promise<ChangeResult[]>

// The column the server fills from the token; list items inherit ownership from their list.
const OWNER_COLUMN: Record<TableName, string | null> = {
  tunes: 'owner_user_id',
  user_tunes: 'user_id',
  lists: 'user_id',
  list_items: null,
  recording_links: 'added_by_user_id',
  recordings: 'user_id',
  recording_loops: 'user_id',
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
  // What the server signs a download or peaks URL against, independent of whatever a test
  // has put on the local db row: the real server always reads the row it just presigned a
  // key for, which a client's own pulled copy of that row can still be behind.
  const downloadSigned = new Map<string, { rev: string; startMs: number }>()
  const peaksSigned = new Map<string, string>()
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

  const impl: SyncApi = {
    async push(changes) {
      pushes.push(changes)
      return { results: await respond(changes) }
    },
    async pull(since) {
      pulls.push(since)
      return pullQueue.shift() ?? { rows: [], next_since: since, has_more: false }
    },
    async resolveLink(url) {
      return { url, provider: 'other', provider_ref: null, title: 'Resolved', artwork_url: null }
    },
    async searchRecordings() {
      return { groups: [] }
    },
    async me() {
      return {
        id: 'server-user',
        clerk_user_id: 'user_1',
        email: null,
        created_at: '2026-09-11T00:00:00Z',
        storage,
      }
    },
    async deleteAccount() {},
    async requestUploadSlot(recordingId, body) {
      if (slotError && (slotErrorId === null || slotErrorId === recordingId)) throw slotError
      const state = recordingStates.get(recordingId) ?? 'pending_upload'
      if (state !== 'pending_upload' && state !== 'failed') {
        throw conflict(state)
      }
      recordingStates.set(recordingId, 'pending_upload')
      return {
        url: `https://fake.r2/${recordingId}/upload?ct=${body.content_type}`,
        expires_at: '2999-01-01T00:00:00Z',
      }
    },
    async uploadFinished(recordingId) {
      if (confirmError) {
        const error = confirmError
        confirmError = null
        throw error
      }
      if (!objects.has(`${recordingId}/upload`)) throw conflict()
      recordingStates.set(recordingId, 'uploaded')
    },
    async retryRecording(recordingId) {
      const state = recordingStates.get(recordingId)
      if (state === 'uploaded' || state === 'processing' || state === 'ready') return
      if (state !== 'failed') throw conflict()
      recordingStates.set(recordingId, 'uploaded')
    },
    async downloadUrl(recordingId) {
      if (recordingStates.get(recordingId) !== 'ready') throw conflict()
      const signed = downloadSigned.get(recordingId) ?? { rev: 'aaaaaaaa', startMs: 0 }
      return {
        url: `https://fake.r2/${recordingId}/playback.m4a`,
        expires_at: '2999-01-01T00:00:00Z',
        playback_rev: signed.rev,
        playback_start_ms: signed.startMs,
      }
    },
    async peaksUrl(recordingId) {
      if (recordingStates.get(recordingId) !== 'ready') throw conflict()
      return {
        url: `https://fake.r2/${recordingId}/peaks.bin`,
        expires_at: '2999-01-01T00:00:00Z',
        peaks_rev: peaksSigned.get(recordingId) ?? 'bbbbbbbb',
      }
    },
    async putObject(url, blob) {
      const key = new URL(url).pathname.slice(1)
      const recordingId = key.split('/')[0]
      if (putError && (putErrorId === null || putErrorId === recordingId)) throw putError
      objects.set(key, blob)
    },
    async getObject(url) {
      const blob = objects.get(new URL(url).pathname.slice(1))
      if (!blob) throw new TransferError(404)
      return blob
    },
  }
  // Wrapping every method means one added to SyncApi honors fail() without remembering to.
  const api = Object.fromEntries(
    Object.entries(impl).map(([name, method]: [string, (...args: unknown[]) => unknown]) => [
      name,
      async (...args: unknown[]) => {
        if (failWith) throw failWith
        return method(...args)
      },
    ]),
  ) as unknown as SyncApi

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
    /** What downloadUrl signs for this recording, regardless of the local db row's own
     * playback_rev: the real server always reads the row it just presigned a key for. */
    signDownload(recordingId: string, rev: string, startMs = 0) {
      downloadSigned.set(recordingId, { rev, startMs })
    },
    /** What peaksUrl signs for this recording, regardless of the local db row's own peaks_rev. */
    signPeaks(recordingId: string, rev: string) {
      peaksSigned.set(recordingId, rev)
    },
  }
}

export function serverTune(overrides: Partial<TuneRow> & { id: string }): TuneRow {
  return {
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    deleted_at: null,
    server_seq: 1,
    owner_user_id: 'server-user',
    title: 'Server Tune',
    alternate_titles: [],
    genre: null,
    tune_type: null,
    modes: [],
    composer: null,
    lyrics: null,
    key: null,
    part_structure: null,
    time_signature: null,
    is_crooked: false,
    tunings: {},
    ...overrides,
  }
}

export function serverUserTune(
  overrides: Partial<UserTuneRow> & { id: string; tune_id: string },
): UserTuneRow {
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
    tune_id: null,
    label: null,
    source: 'microphone',
    recorded_at: '2026-09-11T00:00:00Z',
    position: 0,
    state: 'pending_upload',
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
    ...overrides,
  }
}
