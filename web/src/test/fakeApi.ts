import type {
  Change,
  ChangeResult,
  PullResponse,
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
  user_settings: 'user_id',
}

export function createFakeApi() {
  const pushes: Change[][] = []
  const pulls: number[] = []
  const pullQueue: PullResponse[] = []
  let failWith: unknown = null
  let serverSeq = 0

  /** Echo a pushed change back the way the server does, so the store path runs in tests. */
  function appliedRow(change: Change): Record<string, unknown> {
    serverSeq++
    const owner = OWNER_COLUMN[change.table]
    return {
      ...change.data,
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
  }

  return {
    api,
    pushes,
    pulls,
    respondToPush(fn: PushResponder) {
      respond = fn
    },
    queuePull(...pages: PullResponse[]) {
      pullQueue.push(...pages)
    },
    fail(error: unknown) {
      failWith = error
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
    has_lyrics: null,
    key: null,
    mode: null,
    violin_tuning: null,
    banjo_tuning: null,
    part_structure: null,
    time_signature: null,
    is_crooked: false,
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
