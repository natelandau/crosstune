import Dexie from 'dexie'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { RecordingFile, UploadHandoff } from '../db/recordings'
import { databaseName } from '../db/schema'
import { createUserDb, openTestDb } from '../test/db'
import { recordingFile } from '../test/rows'
import { runUploadHandoffs, userDatabaseNames, type HandoffDeps } from './uploadHandoffs'

const NOW = 1_800_000_000_000

function handoff(extra: Partial<UploadHandoff> = {}): UploadHandoff {
  return {
    url: 'https://r2.example/put/rec-1',
    confirm_token: 'token-1',
    content_type: 'audio/mp4',
    expires_at: NOW + 60_000,
    attempts: 0,
    ...extra,
  }
}

function handedOff(id: string, extra: Partial<RecordingFile> = {}): RecordingFile {
  return recordingFile(id, {
    blob: new Blob(['abc'], { type: 'audio/mp4' }),
    mime: 'audio/mp4',
    bytes: 3,
    local_state: 'uploading',
    upload_attempts: 2,
    next_attempt_at: NOW - 1,
    error: 'Load failed',
    handoff: handoff({ url: `https://r2.example/put/${id}` }),
    ...extra,
  })
}

const respond = (status: number) => new Response(null, { status })

/** A fetch that answers every PUT and every confirm with the given statuses, or throws. */
function fakeFetch(put: number | Error = 200, confirm: number | Error = 204) {
  return vi.fn<typeof fetch>(async (_input, init) => {
    const answer = init?.method === 'PUT' ? put : confirm
    if (answer instanceof Error) throw answer
    return respond(answer)
  })
}

function deps(db: { name: string }, fetch: typeof globalThis.fetch): HandoffDeps {
  return { fetch, now: () => NOW, databaseNames: async () => [db.name] }
}

describe('runUploadHandoffs', () => {
  it('puts the blob and confirms with the token', async () => {
    const db = openTestDb()
    await db.recording_files.put(handedOff('rec-1'))
    const fetch = fakeFetch()

    await runUploadHandoffs(deps(db, fetch))

    expect(fetch).toHaveBeenCalledTimes(2)
    const [putUrl, putInit] = fetch.mock.calls[0]!
    expect(putUrl).toBe('https://r2.example/put/rec-1')
    expect(putInit?.method).toBe('PUT')
    expect(new Headers(putInit?.headers).get('Content-Type')).toBe('audio/mp4')
    expect(new TextDecoder().decode(putInit?.body as ArrayBuffer)).toBe('abc')
    const [confirmUrl, confirmInit] = fetch.mock.calls[1]!
    expect(confirmUrl).toBe('/v1/recordings/rec-1/uploaded-with-token')
    expect(confirmInit?.method).toBe('POST')
    expect(confirmInit?.body).toBeUndefined()
    const headers = new Headers(confirmInit?.headers)
    expect(headers.get('X-Upload-Token')).toBe('token-1')
    expect(headers.has('Authorization')).toBe(false)
    expect(await db.recording_files.get('rec-1')).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
      error: null,
      upload_attempts: 0,
      next_attempt_at: null,
    })
  })

  it("puts a capture's chunks, in order, when they are its stored audio", async () => {
    const db = openTestDb()
    await db.recording_files.put(handedOff('rec-1', { blob: null, chunked: true }))
    await db.recording_chunks.bulkPut([
      { recording_id: 'rec-1', idx: 1, blob: new Blob(['c']) },
      { recording_id: 'rec-1', idx: 0, blob: new Blob(['ab']) },
    ])
    const fetch = fakeFetch()

    await runUploadHandoffs(deps(db, fetch))

    const [, putInit] = fetch.mock.calls[0]!
    expect(new TextDecoder().decode(putInit?.body as ArrayBuffer)).toBe('abc')
    expect((await db.recording_files.get('rec-1'))?.local_state).toBe('uploaded')
  })

  it.each([
    ['a PUT network error', new TypeError('Failed to fetch'), 204],
    ['a PUT 500', 500, 204],
    ['a confirm 502', 200, 502],
    ['a confirm 504', 200, 504],
    ['a confirm 429', 200, 429],
    ['a confirm 401', 200, 401],
    ['a confirm 403', 200, 403],
    ['a confirm 408', 200, 408],
  ] as const)(
    'counts a failed attempt and rejects so the browser retries: %s',
    async (_, put, confirm) => {
      const db = openTestDb()
      await db.recording_files.put(handedOff('rec-1'))

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(runUploadHandoffs(deps(db, fakeFetch(put, confirm)))).rejects.toThrow()
      expect(warn).toHaveBeenCalled()

      const file = await db.recording_files.get('rec-1')
      expect(file?.local_state).toBe('uploading')
      expect(file?.handoff?.attempts).toBe(1)
    },
  )

  it('drops an expired hand-off back to captured', async () => {
    const db = openTestDb()
    await db.recording_files.put(handedOff('rec-1', { handoff: handoff({ expires_at: NOW - 1 }) }))
    const fetch = fakeFetch()

    await runUploadHandoffs(deps(db, fetch))

    expect(fetch).not.toHaveBeenCalled()
    expect(await db.recording_files.get('rec-1')).toMatchObject({
      local_state: 'captured',
      handoff: null,
    })
  })

  it.each([404, 409, 413])(
    'a %i from the confirm leaves the hand-off for the page to take back',
    async (status) => {
      const db = openTestDb()
      await db.recording_files.put(handedOff('rec-1'))

      await runUploadHandoffs(deps(db, fakeFetch(200, status)))

      const file = await db.recording_files.get('rec-1')
      expect(file?.local_state).toBe('uploading')
      expect(file?.handoff?.refused).toBe(true)
    },
  )

  it.each([
    ['refused', { refused: true }],
    ['out of attempts', { attempts: 3 }],
  ] as const)('sends nothing for a hand-off the page will take back: %s', async (_, extra) => {
    const db = openTestDb()
    await db.recording_files.put(
      handedOff('rec-1', { handoff: handoff({ url: 'https://r2.example/put/rec-1', ...extra }) }),
    )
    const fetch = fakeFetch()

    await runUploadHandoffs(deps(db, fetch))

    expect(fetch).not.toHaveBeenCalled()
    expect((await db.recording_files.get('rec-1'))?.handoff).toMatchObject(extra)
  })

  it('leaves a file the page took back mid-upload as the page left it', async () => {
    const db = openTestDb()
    await db.recording_files.put(handedOff('rec-1'))
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === 'PUT') {
        await db.recording_files.update('rec-1', { local_state: 'captured', handoff: null })
      }
      return respond(init?.method === 'PUT' ? 200 : 204)
    })

    await runUploadHandoffs(deps(db, fetch))

    expect(await db.recording_files.get('rec-1')).toMatchObject({
      local_state: 'captured',
      handoff: null,
    })
  })

  it('skips a database that no longer exists', async () => {
    const name = databaseName(`user_${crypto.randomUUID()}`)
    const fetch = fakeFetch()

    await runUploadHandoffs({ fetch, now: () => NOW, databaseNames: async () => [name] })

    expect(fetch).not.toHaveBeenCalled()
    expect(await Dexie.exists(name)).toBe(false)
  })

  it('leaves files without a hand-off alone', async () => {
    const db = openTestDb()
    await db.recording_files.put(
      recordingFile('rec-1', { blob: new Blob(['abc']), local_state: 'captured' }),
    )
    const fetch = fakeFetch()

    await runUploadHandoffs(deps(db, fetch))

    expect(fetch).not.toHaveBeenCalled()
    expect(await db.recording_files.get('rec-1')).toMatchObject({ local_state: 'captured' })
  })

  it('one failing hand-off does not stop the others', async () => {
    const db = openTestDb()
    await db.recording_files.bulkPut([handedOff('rec-1'), handedOff('rec-2')])
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (init?.method === 'PUT' && String(input).endsWith('/rec-1')) {
        throw new TypeError('Failed to fetch')
      }
      return respond(init?.method === 'PUT' ? 200 : 204)
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(runUploadHandoffs(deps(db, fetch))).rejects.toThrow()
    expect(warn).toHaveBeenCalled()

    expect((await db.recording_files.get('rec-1'))?.handoff?.attempts).toBe(1)
    expect(await db.recording_files.get('rec-2')).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
  })

  it('a database that fails to open does not stop the others', async () => {
    const broken = openTestDb()
    const db = openTestDb()
    await broken.recording_files.put(handedOff('rec-1'))
    await db.recording_files.put(handedOff('rec-2'))
    vi.spyOn(Dexie.prototype, 'open').mockRejectedValueOnce(new Dexie.VersionError('newer'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      runUploadHandoffs({
        fetch: fakeFetch(),
        now: () => NOW,
        databaseNames: async () => [broken.name, db.name],
      }),
    ).rejects.toThrow()
    expect(warn).toHaveBeenCalled()

    expect((await broken.recording_files.get('rec-1'))?.handoff?.attempts).toBe(0)
    expect(await db.recording_files.get('rec-2')).toMatchObject({
      local_state: 'uploaded',
      handoff: null,
    })
  })
})

describe('userDatabaseNames', () => {
  it('lists the user databases on this origin and nothing else', async () => {
    const userId = await createUserDb()
    const other = new Dexie(`other-${crypto.randomUUID()}`)
    other.version(1).stores({ things: 'id' })
    onTestFinished(() => other.delete())
    await other.open()
    other.close()

    const names = await userDatabaseNames(indexedDB)

    expect(names).toContain(databaseName(userId))
    expect(names).not.toContain(other.name)
  })
})
