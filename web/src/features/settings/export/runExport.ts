import { settingsId } from '../../../commands/settings'
import type { RecordingFile } from '../../../db/recordings'
import type { CrosstuneDb } from '../../../db/schema'
import { storedInstruments } from '../../../db/types'
import { buildExport, formatDate, type ExportInput } from './buildExport'
import { buildZip, type ZipEntry } from './zip'

export interface ExportCounts {
  onDevice: number
  total: number
}

/** A file whose bytes are all here: a capture in progress or a download without a blob is not. */
function isComplete(file: RecordingFile): file is RecordingFile & { blob: Blob } {
  return file.blob !== null && file.local_state !== 'capturing'
}

/** How many live recordings exist, and how many of those the export can include. */
export async function exportCounts(db: CrosstuneDb): Promise<ExportCounts> {
  return db.transaction('r', db.recordings, db.recording_files, async () => {
    const completeIds = new Set(await db.recording_files.filter(isComplete).primaryKeys())
    const live = db.recordings.filter((recording) => !recording.deleted_at)
    return {
      onDevice: await live
        .clone()
        .filter((recording) => completeIds.has(recording.id))
        .count(),
      total: await live.count(),
    }
  })
}

/** Every table the export reads, in one snapshot, with each complete local audio blob by recording id. */
export async function readExportInput(
  db: CrosstuneDb,
  userId: string,
  timeZone: string,
): Promise<{ input: ExportInput; blobs: Map<string, Blob> }> {
  return db.transaction(
    'r',
    [
      db.tunes,
      db.user_tunes,
      db.lists,
      db.list_items,
      db.recording_links,
      db.recordings,
      db.recording_files,
      db.user_settings,
    ],
    async () => {
      const [tunes, userTunes, lists, listItems, links, recordings, files, settings] =
        await Promise.all([
          db.tunes.toArray(),
          db.user_tunes.toArray(),
          db.lists.toArray(),
          db.list_items.toArray(),
          db.recording_links.toArray(),
          db.recordings.toArray(),
          db.recording_files.toArray(),
          db.user_settings.get(settingsId(userId)),
        ])
      const complete = files.filter(isComplete)
      return {
        input: {
          timeZone,
          instruments: storedInstruments(settings) ?? [],
          tunes,
          userTunes,
          lists,
          listItems,
          links,
          recordings,
          localAudio: complete.map((file) => ({
            recordingId: file.id,
            contentType: file.blob.type || file.mime,
          })),
        },
        blobs: new Map(complete.map((file) => [file.id, file.blob])),
      }
    },
  )
}

export interface CreateExportOptions {
  now: Date
  timeZone: string
  signal?: AbortSignal
  /** Audio entries zipped out of all audio entries; the two CSVs are not counted. */
  onProgress?: (done: number, total: number) => void
}

/** Zip both CSVs and every exported recording from the local store, with no network. */
export async function createExport(
  db: CrosstuneDb,
  userId: string,
  options: CreateExportOptions,
): Promise<{ fileName: string; blob: Blob }> {
  const { now, timeZone, signal, onProgress } = options
  const { input, blobs } = await readExportInput(db, userId, timeZone)
  const plan = buildExport(input)

  const entries: ZipEntry[] = [
    { path: 'tunes.csv', data: new Blob([plan.tunesCsv], { type: 'text/csv' }) },
    { path: 'lists.csv', data: new Blob([plan.listsCsv], { type: 'text/csv' }) },
  ]
  for (const { recordingId, path } of plan.audio) {
    const data = blobs.get(recordingId)
    if (data) entries.push({ path, data })
  }

  const csvCount = 2
  const audioTotal = entries.length - csvCount
  onProgress?.(0, audioTotal)
  const blob = await buildZip(entries, {
    modified: now,
    signal,
    onEntry: (done) => {
      if (done > csvCount) onProgress?.(done - csvCount, audioTotal)
    },
  })

  return { fileName: `crosstune-export-${formatDate(now, timeZone)}.zip`, blob }
}

/** Hand a blob to the browser as a file download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // The browser reads the URL after click() returns, and a revoke before a slow browser reaches
  // it fails the download, so the URL outlives the click by a wide margin.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
