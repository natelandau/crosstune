import { formatDate } from '../../settings/export/buildExport'
import { downloadBlob } from '../../settings/export/runExport'
import { buildZip } from '../../settings/export/zip'
import type { RecordingView } from '../useRecordings'
import { fileNames, nameInput } from './exportName'
import type { ExportReadiness } from './readiness'

export interface ExportItem {
  view: RecordingView
  readiness: ExportReadiness
}

export interface ExportResult {
  files: { name: string; blob: Blob }[]
  /** Files read from the server, never stored on this device. */
  fetched: number
  /** Recordings left out: blocked ones, and ones whose fetch failed. */
  skipped: number
  /** The error of each fetch that failed. */
  failed: unknown[]
}

/** The blob's own type names the file, else the type the row records for it. */
function contentType(blob: Blob, recorded: string | null | undefined): string | null {
  return blob.type || recorded || null
}

interface Gathered {
  view: RecordingView
  blob: Blob
  contentType: string | null
}

function fromLocal(view: RecordingView, blob: Blob): Gathered {
  return { view, blob, contentType: contentType(blob, view.file?.mime) }
}

function named(gathered: readonly Gathered[], timeZone: string): ExportResult['files'] {
  const names = fileNames(
    gathered.map(({ view, contentType }) => nameInput(view, contentType)),
    timeZone,
  )
  return gathered.map(({ blob }, index) => ({ name: names[index]!, blob }))
}

interface GatherOptions {
  fetchFile: (id: string, signal?: AbortSignal) => Promise<Blob>
  timeZone: string
  signal?: AbortSignal
  /** Recordings prepared out of those not blocked. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Each recording's audio, named for export in order. A recording whose fetch fails is left out
 * so the rest still export; an abort rejects with the signal's reason.
 */
export async function gatherRecordings(
  items: readonly ExportItem[],
  { fetchFile, timeZone, signal, onProgress }: GatherOptions,
): Promise<ExportResult> {
  const total = items.filter(({ readiness }) => readiness.kind !== 'blocked').length
  const gathered: Gathered[] = []
  const failed: unknown[] = []
  let fetched = 0
  let skipped = 0
  let done = 0
  onProgress?.(done, total)
  for (const { view, readiness } of items) {
    if (readiness.kind === 'blocked') {
      skipped++
      continue
    }
    signal?.throwIfAborted()
    if (readiness.kind === 'local') {
      gathered.push(fromLocal(view, readiness.blob))
    } else {
      try {
        const blob = await fetchFile(view.recording.id, signal)
        fetched++
        gathered.push({ view, blob, contentType: contentType(blob, view.recording.playback_mime) })
      } catch (cause) {
        signal?.throwIfAborted()
        skipped++
        failed.push(cause)
      }
    }
    onProgress?.(++done, total)
  }
  signal?.throwIfAborted()
  return { files: named(gathered, timeZone), fetched, skipped, failed }
}

/** One file downloads as itself; several download as one zip with each at its root. */
export async function deliverDownload(
  files: ExportResult['files'],
  now: Date,
  timeZone: string,
  signal?: AbortSignal,
): Promise<void> {
  if (files.length === 0) return
  if (files.length === 1) {
    const [{ name, blob }] = files as [ExportResult['files'][number]]
    downloadBlob(blob, name)
    return
  }
  const zip = await buildZip(
    files.map(({ name, blob }) => ({ path: name, data: blob })),
    { modified: now, signal },
  )
  signal?.throwIfAborted()
  downloadBlob(zip, `crosstune-recordings-${formatDate(now, timeZone)}.zip`)
}

function asFiles(files: ExportResult['files']): File[] {
  return files.map(({ name, blob }) => new File([blob], name, { type: blob.type }))
}

/**
 * The files a share sends, named as `gatherRecordings` names them, or null unless every
 * recording is held here. A share opens only during the person's tap, which a fetch outlasts.
 */
export function shareFiles(
  items: readonly ExportItem[],
  timeZone: string,
): ExportResult['files'] | null {
  if (items.length === 0) return null
  const gathered: Gathered[] = []
  for (const { view, readiness } of items) {
    if (readiness.kind !== 'local') return null
    gathered.push(fromLocal(view, readiness.blob))
  }
  return named(gathered, timeZone)
}

/** Whether to offer Share: every recording is held here and the browser can share the files. */
export function canShareSelection(items: readonly ExportItem[], timeZone: string): boolean {
  if (typeof navigator.canShare !== 'function') return false
  const files = shareFiles(items, timeZone)
  return files !== null && navigator.canShare({ files: asFiles(files) })
}

/** Opens the system share sheet; the browser allows it only during the user's tap. */
export async function deliverShare(files: ExportResult['files']): Promise<void> {
  await navigator.share({ files: asFiles(files) })
}
