import { describe, expect, it } from 'vitest'
import { recordingRow } from '../../../test/rows'
import { exportProgress } from '../../settings/export/exportCopy'
import { EXPORT_BLOCK_REASONS, exportSkipped } from './exportCopy'
import {
  exportSheetContent,
  failureState,
  settledState,
  skippedLine,
  type ExportState,
} from './exportState'
import type { ExportReadiness } from './readiness'
import type { ExportItem, ExportResult } from './runRecordingExport'

const file = (name: string) => ({ name, blob: new Blob([name]) })

function result(files: number, { skipped = 0, failed = [] as unknown[] } = {}): ExportResult {
  return {
    files: Array.from({ length: files }, (_, i) => file(`r${i}.m4a`)),
    fetched: 0,
    skipped,
    failed,
  }
}

describe('settledState', () => {
  it.each<[string, ExportResult, ExportState]>([
    [
      'counts a failed fetch as left out',
      result(2, { skipped: 1, failed: [new Error('network')] }),
      { kind: 'done', leftOut: 1 },
    ],
    [
      'never counts a recording blocked up front as left out',
      result(1, { skipped: 1 }),
      { kind: 'done', leftOut: 0 },
    ],
    [
      'fails with the fetch error when nothing was gathered',
      result(0, { skipped: 1, failed: [new Error('network')] }),
      { kind: 'failed', message: 'network' },
    ],
    [
      'returns to idle when nothing was gathered and nothing failed',
      result(0, { skipped: 2 }),
      {
        kind: 'idle',
      },
    ],
  ])('%s', (_name, input, expected) => {
    expect(settledState(input)).toEqual(expected)
  })
})

describe('failureState', () => {
  it.each<[string, unknown, ExportState]>([
    [
      'a closed share sheet returns to idle',
      new DOMException('closed', 'AbortError'),
      {
        kind: 'idle',
      },
    ],
    [
      'any other error fails with its message',
      new Error('disk full'),
      {
        kind: 'failed',
        message: 'disk full',
      },
    ],
  ])('%s', (_name, cause, expected) => {
    expect(failureState(cause)).toEqual(expected)
  })
})

const item = (readiness: ExportReadiness): ExportItem => ({
  view: {
    recording: recordingRow('r1'),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  },
  readiness,
})
const fetch = item({ kind: 'fetch' })
const offline = item({ kind: 'blocked', reason: 'offline' })
const capturing = item({ kind: 'blocked', reason: 'capturing' })

describe('skippedLine', () => {
  it.each<[string, ExportItem[], string | null]>([
    ['one recording blocked gives its own reason', [capturing], EXPORT_BLOCK_REASONS.capturing],
    ['several with some blocked give the count', [fetch, offline, capturing], exportSkipped(2, 3)],
    ['one blocked among several gives the count', [fetch, offline], exportSkipped(1, 2)],
    ['nothing blocked gives none', [fetch, fetch], null],
    ['one recording not blocked gives none', [fetch], null],
  ])('%s', (_name, items, expected) => {
    expect(skippedLine(items)).toBe(expected)
  })
})

describe('exportSheetContent', () => {
  it.each<[string, ExportState, ExportItem[], Partial<ReturnType<typeof exportSheetContent>>]>([
    [
      'shows progress and holds the sheet while preparing',
      { kind: 'preparing', done: 1, total: 2 },
      [fetch, fetch],
      { progress: exportProgress(1, 2), pending: true, error: null },
    ],
    [
      'shows the failure once the export fails',
      { kind: 'failed', message: 'network' },
      [fetch],
      { progress: null, pending: false, error: 'network' },
    ],
    [
      'cannot continue when every recording is blocked',
      { kind: 'idle' },
      [offline, capturing],
      { canContinue: false },
    ],
    [
      'can continue when one recording can export',
      { kind: 'idle' },
      [offline, fetch],
      { canContinue: true },
    ],
  ])('%s', (_name, state, items, expected) => {
    expect(exportSheetContent(state, items)).toMatchObject(expected)
  })
})
