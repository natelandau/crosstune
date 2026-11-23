import * as Sentry from '@sentry/react'
import type { ReadBody } from '../../../api/types'
import { InsufficientStorageError, isQuotaError, storageHeadroom } from '../../../platform/storage'
import { defaultLocks, heldLockSuffixes, holdLock } from '../../../sync/captureLock'
import { roomAboveReserve } from '../../../sync/transfers'
import { exportNeedsSpace } from './exportCopy'

// Files an export fetches from the server are written to the browser's private file system
// instead of memory, so an export of several gigabytes never holds them all in the page. The
// returned Blobs are disk-backed, and the zip writer references them without copying.

export const EXPORT_STAGING_FOLDER = 'export-staging'
const LOCK_PREFIX = `${EXPORT_STAGING_FOLDER}:`

export interface ExportStaging {
  /** A `ReadBody` that writes the response to a staged file and returns it as a disk-backed Blob. */
  stage: ReadBody
  /** Deletes this export's folder, for an export that failed or was abandoned. Never rejects. */
  discard(): Promise<void>
}

export interface OpenStagingOptions {
  /** Bytes the export expects to fetch, checked against the room above the capture reserve. */
  plannedBytes: number
  headroom?: () => Promise<number | null>
  /** Null when the browser has none, which leaves no way to tell a folder in use from one left. */
  locks?: LockManager | null
}

/** Releases the locks this page holds on its staging folders, for `clearExportStaging`. */
const heldReleases = new Set<() => void>()

const isNotFound = (error: unknown) =>
  error instanceof DOMException && error.name === 'NotFoundError'

/** Remove a staged entry. A missing one is already gone; any other failure is reported, since a
 * leftover folder only costs disk until a later sweep or sign-out. */
async function removeQuietly(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive: true })
  } catch (error) {
    if (!isNotFound(error)) Sentry.captureException(error)
  }
}

/**
 * The private file system's root, or null when this browser cannot stream a response into it:
 * no `createWritable` (Safari before 26), or no private file system for this window, which
 * WebKit refuses with a DOMException in a private or ephemeral session.
 */
async function privateRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (
    typeof navigator.storage?.getDirectory !== 'function' ||
    typeof FileSystemFileHandle === 'undefined' ||
    typeof FileSystemFileHandle.prototype.createWritable !== 'function'
  ) {
    return null
  }
  try {
    return await navigator.storage.getDirectory()
  } catch (error) {
    if (error instanceof DOMException) return null
    throw error
  }
}

async function stagingRoot(
  root: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(EXPORT_STAGING_FOLDER, { create })
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

/**
 * Open a staging folder for one export. Resolves to null when the browser cannot stream a
 * response to a file, so the caller reads into memory instead. Throws
 * `InsufficientStorageError` when `plannedBytes` would use the room kept for new recordings.
 */
export async function openExportStaging({
  plannedBytes,
  headroom = storageHeadroom,
  locks = defaultLocks() ?? null,
}: OpenStagingOptions): Promise<ExportStaging | null> {
  const base = locks ? await privateRoot() : null
  if (!base || !locks) return null
  const room = await roomAboveReserve(headroom)
  if (!room.fits(plannedBytes)) {
    throw new InsufficientStorageError(exportNeedsSpace(room.shortBy(plannedBytes)))
  }

  const name = crypto.randomUUID()
  // The lock comes before the folder, so a sweep in another tab never sees the folder unlocked.
  // A finished export keeps its lock until the page closes, since the browser may still be
  // reading a staged file for the download.
  let release: () => void
  try {
    release = await holdLock(`${LOCK_PREFIX}${name}`, locks)
  } catch (error) {
    if (error instanceof DOMException) return null
    throw error
  }
  let root: FileSystemDirectoryHandle
  let folder: FileSystemDirectoryHandle
  try {
    root = (await stagingRoot(base, true))!
    folder = await root.getDirectoryHandle(name, { create: true })
  } catch (error) {
    release()
    if (isQuotaError(error)) throw new InsufficientStorageError(exportNeedsSpace(null))
    throw error
  }
  heldReleases.add(release)
  const writing = new Set<Promise<unknown>>()
  let count = 0

  const write = async (response: Response, signal?: AbortSignal): Promise<Blob> => {
    const fileName = String(count++)
    let handle: FileSystemFileHandle
    try {
      handle = await folder.getFileHandle(fileName, { create: true })
      const writable = await handle.createWritable()
      if (response.body) await response.body.pipeTo(writable, { signal })
      else await writable.close()
    } catch (error) {
      await removeQuietly(folder, fileName)
      if (isQuotaError(error)) throw new InsufficientStorageError(exportNeedsSpace(null))
      throw error
    }
    const file = await handle.getFile()
    // A slice keeps the Blob disk-backed and gives it the response's type.
    return file.slice(0, file.size, response.headers.get('Content-Type') ?? '')
  }

  return {
    stage(response, signal) {
      const work = write(response, signal)
      const forget = () => writing.delete(work)
      writing.add(work)
      void work.then(forget, forget)
      return work
    },
    async discard() {
      // A write still unwinding holds its file open, and an open file blocks the folder's removal.
      await Promise.allSettled(writing)
      await removeQuietly(root, name)
      release()
      heldReleases.delete(release)
    },
  }
}

/** Clear what closed pages left, then open staging for an export that fetches `plannedBytes`. */
async function openStagingAfterSweep(plannedBytes: number): Promise<ExportStaging | null> {
  await sweepExportStaging()
  return openExportStaging({ plannedBytes })
}

/**
 * Run an export that fetches files of `fetchedSizes` (null for an unknown size), handing `run`
 * the reader that stages each one on disk. Staging opens only when something is fetched. A
 * failed or abandoned export discards its staged files; a finished one keeps them for its
 * download.
 */
export async function withExportStaging<T>(
  fetchedSizes: readonly (number | null)[],
  run: (readBody?: ReadBody) => Promise<T>,
  open: (plannedBytes: number) => Promise<ExportStaging | null> = openStagingAfterSweep,
): Promise<T> {
  const plannedBytes = fetchedSizes.reduce<number>((sum, size) => sum + (size ?? 0), 0)
  const staging = fetchedSizes.length > 0 ? await open(plannedBytes) : null
  try {
    return await run(staging?.stage)
  } catch (error) {
    await staging?.discard()
    throw error
  }
}

/**
 * Delete every staging folder whose page has closed. Never rejects: a leftover folder only
 * costs disk, so a failed sweep is reported and never stops an export or the app start.
 */
export async function sweepExportStaging(locks = defaultLocks()): Promise<void> {
  try {
    const base = locks ? await privateRoot() : null
    const root = base ? await stagingRoot(base, false) : null
    if (!root || !locks) return
    // Folders first, then locks: an export takes its lock before it makes its folder, so every
    // folder listed here was either locked before the query or belongs to a closed page.
    const listed: string[] = []
    for await (const name of root.keys()) listed.push(name)
    if (listed.length === 0) return
    const inUse = await heldLockSuffixes(LOCK_PREFIX, locks)
    await Promise.all(
      listed.filter((name) => !inUse.has(name)).map((name) => removeQuietly(root, name)),
    )
  } catch (error) {
    Sentry.captureException(error)
  }
}

/**
 * Delete every staging folder, for sign-out and account deletion. Also release this page's
 * locks, so a sweep can remove anything the delete leaves behind.
 */
export async function clearExportStaging(): Promise<void> {
  try {
    const root = await privateRoot()
    if (!root) return
    try {
      await root.removeEntry(EXPORT_STAGING_FOLDER, { recursive: true })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  } finally {
    for (const release of heldReleases) release()
    heldReleases.clear()
  }
}
