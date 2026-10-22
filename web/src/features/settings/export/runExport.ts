import { settingsId } from '../../../commands/settings'
import type { RecordingFile } from '../../../db/recordings'
import type { ScanFile } from '../../../db/scans'
import type { CrosstuneDb } from '../../../db/schema'
import { storedInstruments, type LocalRecording, type LocalScan } from '../../../db/types'
import { buildExport, formatDate, selectExportFiles, type ExportInput } from './buildExport'
import { buildZip, type ZipEntry } from './zip'

export type ExportFileKind = 'recording' | 'scan'

/** Reads one recording's audio or one scan's image from the server, storing nothing. */
export type FetchMissing = (kind: ExportFileKind, id: string, signal?: AbortSignal) => Promise<Blob>

export interface ExportCounts {
  /** Recording and scan files the export takes from this device. */
  onDevice: number
  /** Every recording and scan file the export holds. */
  total: number
  /** Files the export fetches from the server, which needs a connection. */
  missing: number
}

/** A file whose bytes are all here: a capture in progress or a download without a blob is not. */
function isComplete(file: RecordingFile): file is RecordingFile & { blob: Blob } {
  return file.blob !== null && file.local_state !== 'capturing'
}

interface ExportSnapshot {
  input: ExportInput
  blobs: Map<string, Blob>
  scanBlobs: Map<string, Blob>
}

/**
 * The audio and scan images an export can hold: each complete local file, then each ready file
 * this device does not hold, which the export fetches. The server serves only a ready file, so
 * anything else not held here stays out.
 */
function availableFiles(
  recordings: readonly LocalRecording[],
  files: readonly RecordingFile[],
  scans: readonly LocalScan[],
  scanFiles: readonly ScanFile[],
): Pick<ExportInput, 'audio' | 'scanIds'> & Omit<ExportSnapshot, 'input'> {
  const complete = files.filter(isComplete)
  const blobs = new Map(complete.map((file) => [file.id, file.blob]))
  const scanBlobs = new Map(scanFiles.map((file) => [file.id, file.blob]))
  return {
    audio: [
      ...complete.map((file) => ({
        recordingId: file.id,
        contentType: file.blob.type || file.mime,
      })),
      ...recordings
        .filter((recording) => recording.state === 'ready' && !blobs.has(recording.id))
        .map((recording) => ({ recordingId: recording.id, contentType: recording.playback_mime })),
    ],
    scanIds: new Set([
      ...scanBlobs.keys(),
      ...scans.filter((scan) => scan.state === 'ready' && !scanBlobs.has(scan.id)).map((s) => s.id),
    ]),
    blobs,
    scanBlobs,
  }
}

/**
 * Every table the export reads, in one snapshot, with each complete local audio blob and scan
 * image by id. The input also lists each ready file this device does not hold.
 */
export async function readExportInput(
  db: CrosstuneDb,
  userId: string,
  timeZone: string,
): Promise<ExportSnapshot> {
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
      db.scans,
      db.scan_files,
      db.user_settings,
      db.places,
    ],
    async () => {
      const [
        tunes,
        userTunes,
        lists,
        listItems,
        links,
        recordings,
        files,
        scans,
        scanFiles,
        settings,
        places,
      ] = await Promise.all([
        db.tunes.toArray(),
        db.user_tunes.toArray(),
        db.lists.toArray(),
        db.list_items.toArray(),
        db.recording_links.toArray(),
        db.recordings.toArray(),
        db.recording_files.toArray(),
        db.scans.toArray(),
        db.scan_files.toArray(),
        db.user_settings.get(settingsId(userId)),
        db.places.toArray(),
      ])
      const { audio, scanIds, blobs, scanBlobs } = availableFiles(
        recordings,
        files,
        scans,
        scanFiles,
      )
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
          audio,
          scans,
          scanIds,
          places,
        },
        blobs,
        scanBlobs,
      }
    },
  )
}

/**
 * How many recording and scan files the export holds, and how many of those it must fetch,
 * chosen as the export chooses them but read from only the tables that choice needs.
 */
export async function exportCounts(db: CrosstuneDb): Promise<ExportCounts> {
  return db.transaction(
    'r',
    [db.tunes, db.user_tunes, db.recordings, db.recording_files, db.scans, db.scan_files],
    async () => {
      const [tunes, userTunes, recordings, files, scans, scanFiles] = await Promise.all([
        db.tunes.toArray(),
        db.user_tunes.toArray(),
        db.recordings.toArray(),
        db.recording_files.toArray(),
        db.scans.toArray(),
        db.scan_files.toArray(),
      ])
      const { audio, scanIds, blobs, scanBlobs } = availableFiles(
        recordings,
        files,
        scans,
        scanFiles,
      )
      const selected = selectExportFiles({ tunes, userTunes, recordings, audio, scans, scanIds })
      const total = selected.recordings.length + selected.scans.length
      const onDevice =
        selected.recordings.filter(({ id }) => blobs.has(id)).length +
        selected.scans.filter(({ id }) => scanBlobs.has(id)).length
      return { onDevice, total, missing: total - onDevice }
    },
  )
}

export interface CreateExportOptions {
  now: Date
  timeZone: string
  /** Reads each file this device does not hold; a rejection fails the whole export. */
  fetchMissing: FetchMissing
  signal?: AbortSignal
  /** Files zipped out of all recording and scan files; the CSVs are not counted. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Zip the CSVs and every exported recording and scan. A file this device does not hold is
 * fetched into the zip and never stored, so a file the plan keeps off the device stays off it.
 */
export async function createExport(
  db: CrosstuneDb,
  userId: string,
  options: CreateExportOptions,
): Promise<{ fileName: string; blob: Blob }> {
  const { now, timeZone, fetchMissing, signal, onProgress } = options
  const { input, blobs, scanBlobs } = await readExportInput(db, userId, timeZone)
  const plan = buildExport(input)

  const entries: ZipEntry[] = [
    { path: 'tunes.csv', data: new Blob([plan.tunesCsv], { type: 'text/csv' }) },
    { path: 'lists.csv', data: new Blob([plan.listsCsv], { type: 'text/csv' }) },
    { path: 'recordings.csv', data: new Blob([plan.recordingsCsv], { type: 'text/csv' }) },
  ]
  const csvCount = entries.length
  for (const { recordingId, path } of plan.audio) {
    entries.push({
      path,
      data: blobs.get(recordingId) ?? ((read) => fetchMissing('recording', recordingId, read)),
    })
  }
  for (const { scanId, path } of plan.scans) {
    entries.push({
      path,
      data: scanBlobs.get(scanId) ?? ((read) => fetchMissing('scan', scanId, read)),
    })
  }

  const fileTotal = entries.length - csvCount
  onProgress?.(0, fileTotal)
  const blob = await buildZip(entries, {
    modified: now,
    signal,
    onEntry: (done) => {
      if (done > csvCount) onProgress?.(done - csvCount, fileTotal)
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
