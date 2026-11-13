import { messageFor } from '../../../ui/useAction'
import { exportProgress } from '../../settings/export/exportCopy'
import { EXPORT_BLOCK_REASONS, exportSkipped } from './exportCopy'
import type { ExportItem, ExportResult } from './runRecordingExport'

export type ExportState =
  | { kind: 'idle' }
  /** Recordings prepared so far, out of those not blocked. */
  | { kind: 'preparing'; done: number; total: number }
  /** Delivered; `leftOut` counts recordings whose fetch failed, not ones blocked up front. */
  | { kind: 'done'; leftOut: number }
  | { kind: 'failed'; message: string }

export const IDLE: ExportState = { kind: 'idle' }

/**
 * Where gathering leaves an export: `done` once the files are delivered, else failed when a
 * fetch failed and nothing was gathered, else idle.
 */
export function settledState({ files, failed }: ExportResult): ExportState {
  if (files.length > 0) return { kind: 'done', leftOut: failed.length }
  return failed.length > 0 ? { kind: 'failed', message: messageFor(failed[0]) } : IDLE
}

/** A share the person closes rejects with AbortError; that is a choice, not a failure. */
export function failureState(cause: unknown): ExportState {
  if (cause instanceof DOMException && cause.name === 'AbortError') return IDLE
  return { kind: 'failed', message: messageFor(cause) }
}

/** How many of `items` cannot be exported. */
export function blockedCount(items: readonly ExportItem[]): number {
  return items.filter(({ readiness }) => readiness.kind === 'blocked').length
}

/** What an export leaves out: a lone recording's own reason, else how many of the selection. */
export function skippedLine(items: readonly ExportItem[]): string | null {
  const blocked = blockedCount(items)
  if (blocked === 0) return null
  const [first] = items
  if (items.length === 1 && first?.readiness.kind === 'blocked') {
    return EXPORT_BLOCK_REASONS[first.readiness.reason]
  }
  return exportSkipped(blocked, items.length)
}

/** What the download sheet shows for `items`, the download as the sheet opened, in `state`. */
export function exportSheetContent(state: ExportState, items: readonly ExportItem[]) {
  return {
    skipped: skippedLine(items),
    progress: state.kind === 'preparing' ? exportProgress(state.done, state.total) : null,
    error: state.kind === 'failed' ? state.message : null,
    pending: state.kind === 'preparing',
    canContinue: blockedCount(items) < items.length,
  }
}
