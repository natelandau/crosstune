import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeLockManager } from '../../../test/fakeLocks'
import { InsufficientStorageError } from '../../../platform/storage'
import { CAPTURE_RESERVE_BYTES } from '../../../sync/transfers'
import { exportNeedsSpace } from './exportCopy'
import {
  clearExportStaging,
  EXPORT_STAGING_FOLDER,
  openExportStaging,
  sweepExportStaging,
} from './staging'

// Runs against the browser's real private file system, so it shows that a staged file reads back
// from disk with its bytes and type.

/**
 * One page's locks. A sweep that asks another page's manager sees none of these, as a sweep
 * sees a closed page. `beforeQuery` runs once inside the next query, after the held locks are
 * read, to stand in for another tab acting at that moment.
 */
class PageLocks extends FakeLockManager {
  beforeQuery?: () => Promise<void>

  override async query(): Promise<LockManagerSnapshot> {
    const snapshot = await super.query()
    const hook = this.beforeQuery
    this.beforeQuery = undefined
    await hook?.()
    return snapshot
  }
}

const heldCount = async (locks: LockManager) => (await locks.query()).held?.length ?? 0

const plenty = async () => 10 * CAPTURE_RESERVE_BYTES

async function stagedFolders(): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  let staging: FileSystemDirectoryHandle
  try {
    staging = await root.getDirectoryHandle(EXPORT_STAGING_FOLDER)
  } catch {
    return []
  }
  const names: string[] = []
  for await (const name of staging.keys()) names.push(name)
  return names
}

async function stagedFiles(folder: string): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  const staging = await root.getDirectoryHandle(EXPORT_STAGING_FOLDER)
  const dir = await staging.getDirectoryHandle(folder)
  const names: string[] = []
  for await (const name of dir.keys()) names.push(name)
  return names
}

/** A body that sends `first`, then fails with `error`. */
function failingBody(first: Uint8Array, error: unknown): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream({
    pull(controller) {
      if (sent) controller.error(error)
      else {
        sent = true
        controller.enqueue(first)
      }
    },
  })
}

afterEach(async () => {
  await clearExportStaging()
})

describe('openExportStaging', () => {
  it('stages a body to disk and returns its bytes with the response type', async () => {
    const staging = await openExportStaging({
      plannedBytes: 3,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'audio/mp4' },
    })
    const blob = await staging!.stage(response)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(blob.type).toBe('audio/mp4')
    const [folder] = await stagedFolders()
    expect(await stagedFiles(folder!)).toHaveLength(1)
  })

  it('stages a retried download whole, leaving nothing of the failed try', async () => {
    const staging = await openExportStaging({
      plannedBytes: 3,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const dropped = new Response(failingBody(new Uint8Array([9, 9]), new TypeError('network')))
    await expect(staging!.stage(dropped)).rejects.toBeInstanceOf(TypeError)
    const blob = await staging!.stage(new Response(new Uint8Array([1, 2, 3])))
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    const [folder] = await stagedFolders()
    expect(await stagedFiles(folder!)).toHaveLength(1)
  })

  it('refuses when the planned bytes do not fit above the capture reserve', async () => {
    const opening = openExportStaging({
      plannedBytes: 2_100_000_100,
      headroom: async () => CAPTURE_RESERVE_BYTES + 100,
      locks: new PageLocks(),
    })
    await expect(opening).rejects.toSatisfy(
      (error) =>
        error instanceof InsufficientStorageError &&
        error.message === exportNeedsSpace(2_100_000_000),
    )
    expect(await stagedFolders()).toEqual([])
  })

  it('turns a quota error mid-write into an out-of-room error and removes the partial file', async () => {
    const staging = await openExportStaging({
      plannedBytes: 0,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const full = new Response(
      failingBody(new Uint8Array([1]), new DOMException('full', 'QuotaExceededError')),
    )
    await expect(staging!.stage(full)).rejects.toSatisfy(
      (error) =>
        error instanceof InsufficientStorageError && error.message === exportNeedsSpace(null),
    )
    const [folder] = await stagedFolders()
    expect(await stagedFiles(folder!)).toEqual([])
  })

  it('stops a stage when its signal aborts and removes the partial file', async () => {
    const staging = await openExportStaging({
      plannedBytes: 0,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const controller = new AbortController()
    const endless = new ReadableStream<Uint8Array>({
      pull(stream) {
        stream.enqueue(new Uint8Array([1]))
        controller.abort(new Error('cancelled'))
      },
    })
    await expect(staging!.stage(new Response(endless), controller.signal)).rejects.toThrow(
      'cancelled',
    )
    const [folder] = await stagedFolders()
    expect(await stagedFiles(folder!)).toEqual([])
  })

  it('is null when the browser cannot stream to a file', async () => {
    const proto = FileSystemFileHandle.prototype
    const original = Object.getOwnPropertyDescriptor(proto, 'createWritable')
    Object.defineProperty(proto, 'createWritable', { value: undefined, configurable: true })
    try {
      expect(
        await openExportStaging({ plannedBytes: 1, headroom: plenty, locks: new PageLocks() }),
      ).toBeNull()
    } finally {
      if (original) Object.defineProperty(proto, 'createWritable', original)
      else delete (proto as { createWritable?: unknown }).createWritable
    }
  })
  it('is null when the lock is refused, leaving no folder', async () => {
    const locks = {
      request: async () => {
        throw new DOMException('opaque origin', 'SecurityError')
      },
    } as unknown as LockManager
    expect(await openExportStaging({ plannedBytes: 1, headroom: plenty, locks })).toBeNull()
    expect(await stagedFolders()).toEqual([])
  })

  it('is null without Web Locks, since no sweep could tell its folder is in use', async () => {
    expect(await openExportStaging({ plannedBytes: 1, headroom: plenty, locks: null })).toBeNull()
  })

  it('is null when the window has no private file system, and cleanup has nothing to do', async () => {
    const refused = new DOMException('unavailable', 'UnknownError')
    const getDirectory = vi.spyOn(navigator.storage, 'getDirectory').mockRejectedValue(refused)
    try {
      expect(
        await openExportStaging({ plannedBytes: 1, headroom: plenty, locks: new PageLocks() }),
      ).toBeNull()
      await expect(sweepExportStaging(new PageLocks())).resolves.toBeUndefined()
      await expect(clearExportStaging()).resolves.toBeUndefined()
    } finally {
      getDirectory.mockRestore()
    }
  })
})

describe('cleanup', () => {
  it("a sweep deletes a closed page's folder and keeps an open one", async () => {
    const closedPage = new PageLocks()
    const openPage = new PageLocks()
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks: closedPage })
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks: openPage })
    const [openLock] = (await openPage.query()).held!
    await sweepExportStaging(openPage)
    expect(await stagedFolders()).toEqual([openLock!.name!.split(':')[1]])
  })

  it('a sweep never deletes the folder of an export that opens while it runs', async () => {
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks: new PageLocks() })
    const sweeping = new PageLocks()
    let opening: Promise<unknown> | undefined
    sweeping.beforeQuery = async () => {
      opening = openExportStaging({ plannedBytes: 0, headroom: plenty, locks: sweeping })
      await opening
    }
    await sweepExportStaging(sweeping)
    await opening
    expect(await stagedFolders()).toHaveLength(1)
  })

  it('a sweep that cannot remove a folder still resolves', async () => {
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks: new PageLocks() })
    const remove = vi
      .spyOn(FileSystemDirectoryHandle.prototype, 'removeEntry')
      .mockRejectedValueOnce(new DOMException('in use', 'NoModificationAllowedError'))
    try {
      await expect(sweepExportStaging(new PageLocks())).resolves.toBeUndefined()
    } finally {
      remove.mockRestore()
    }
  })

  it('discard waits for a stage still writing, then removes the folder', async () => {
    const staging = await openExportStaging({
      plannedBytes: 0,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const controller = new AbortController()
    let pulled!: () => void
    const started = new Promise<void>((resolve) => (pulled = resolve))
    const endless = new ReadableStream<Uint8Array>({
      pull(stream) {
        stream.enqueue(new Uint8Array(1024))
        pulled()
      },
    })
    const writing = staging!.stage(new Response(endless), controller.signal)
    await started
    controller.abort(new Error('cancelled'))
    await staging!.discard()
    expect(await stagedFolders()).toEqual([])
    await expect(writing).rejects.toThrow('cancelled')
  })

  it("discard releases the export's lock", async () => {
    const locks = new PageLocks()
    const staging = await openExportStaging({ plannedBytes: 0, headroom: plenty, locks })
    await staging!.discard()
    await expect.poll(() => heldCount(locks)).toBe(0)
  })

  it("clearing releases this page's locks", async () => {
    const locks = new PageLocks()
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks })
    await clearExportStaging()
    await expect.poll(() => heldCount(locks)).toBe(0)
  })

  it("discard deletes this export's folder only", async () => {
    const locks = new PageLocks()
    const first = await openExportStaging({ plannedBytes: 0, headroom: plenty, locks })
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks })
    await first!.discard()
    expect(await stagedFolders()).toHaveLength(1)
  })

  it('discard never rejects, so a failed export keeps its own error', async () => {
    const staging = await openExportStaging({
      plannedBytes: 0,
      headroom: plenty,
      locks: new PageLocks(),
    })
    const refused = new DOMException('in use', 'NoModificationAllowedError')
    const remove = vi
      .spyOn(FileSystemDirectoryHandle.prototype, 'removeEntry')
      .mockRejectedValueOnce(refused)
    try {
      await expect(staging!.discard()).resolves.toBeUndefined()
    } finally {
      remove.mockRestore()
    }
  })

  it('clearing deletes every staged folder', async () => {
    const locks = new PageLocks()
    await openExportStaging({ plannedBytes: 0, headroom: plenty, locks })
    await clearExportStaging()
    expect(await stagedFolders()).toEqual([])
  })
})
