import { isRecordingPrecision } from '../../db/types'
import { containsText } from '../../text/fold'
import { nextSort as nextChoice, type SortChoice as Choice } from '../../ui/sortChoice'
import type { RecordingView } from './useRecordings'

export type RecordingSort = 'added' | 'recorded' | 'title' | 'tune'

/** Every sort, in the order the sort menu lists them. */
export const RECORDING_SORTS: readonly RecordingSort[] = ['added', 'recorded', 'title', 'tune']

/** True for a sort whose first direction is newest first rather than A first. */
export function isDateSort(sort: RecordingSort): boolean {
  return sort === 'added' || sort === 'recorded'
}

export type SortChoice = Choice<RecordingSort>

export const DEFAULT_SORT: SortChoice = { sort: 'added', descending: true }

export interface TuneGroup {
  tuneId: string
  tuneTitle: string
  views: RecordingView[]
}

export type FiledArrangement =
  { kind: 'flat'; views: RecordingView[] } | { kind: 'byTune'; groups: TuneGroup[] }

export interface Arrangement {
  unfiled: RecordingView[]
  filed: FiledArrangement
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' })

// Parsed, not compared as text: a row written here and one pulled from the server spell
// the same instant with different fractional-second precision.
function addedAt(view: RecordingView): number {
  return Date.parse(view.recording.added_at)
}

// A partial date is stored as the start of its period, so it sorts there with no adjustment.
// A precision this client predates reads as unknown, as it does on the row.
function recordedAt(view: RecordingView): number | null {
  const { recorded_at: at, recorded_precision: precision } = view.recording
  return at === null || !isRecordingPrecision(precision) ? null : Date.parse(at)
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Equal instants break by id, so the order is stable and reversing it mirrors it exactly.
function newestAddedFirst(a: RecordingView, b: RecordingView): number {
  return addedAt(b) - addedAt(a) || compareIds(b.recording.id, a.recording.id)
}

function byAdded(descending: boolean) {
  return (a: RecordingView, b: RecordingView) =>
    descending ? newestAddedFirst(a, b) : -newestAddedFirst(a, b)
}

// Title and Tune start at A, which reads as newest first for the dates beside them.
function byAddedForAFirst(descending: boolean) {
  return byAdded(!descending)
}

// Unknown dates come last in both directions; equal or unknown dates fall back to date added.
function byRecorded(descending: boolean) {
  const added = byAdded(descending)
  return (a: RecordingView, b: RecordingView) => {
    const x = recordedAt(a)
    const y = recordedAt(b)
    if (x === null || y === null) return Number(x === null) - Number(y === null) || added(a, b)
    return (descending ? y - x : x - y) || added(a, b)
  }
}

function labelOf(view: RecordingView): string {
  return view.recording.label?.trim() ?? ''
}

function byTitle(descending: boolean) {
  const dates = byAddedForAFirst(descending)
  return (a: RecordingView, b: RecordingView) => {
    const x = labelOf(a)
    const y = labelOf(b)
    if (!x || !y) return Number(!x) - Number(!y) || dates(a, b)
    const order = collator.compare(x, y)
    return (descending ? -order : order) || dates(a, b)
  }
}

function matches(view: RecordingView, needle: string): boolean {
  return containsText(labelOf(view), needle) || containsText(view.tuneTitle ?? '', needle)
}

function ownFirstThenNewestAdded(a: RecordingView, b: RecordingView): number {
  const imported = (view: RecordingView) => Number(view.recording.origin !== 'own')
  return imported(a) - imported(b) || newestAddedFirst(a, b)
}

function groupByTune(views: RecordingView[], descending: boolean): TuneGroup[] {
  const byId = new Map<string, TuneGroup>()
  for (const view of views) {
    if (!view.tuneId) continue
    const group = byId.get(view.tuneId)
    if (group) group.views.push(view)
    else
      byId.set(view.tuneId, { tuneId: view.tuneId, tuneTitle: view.tuneTitle ?? '', views: [view] })
  }
  const groups = [...byId.values()].sort((a, b) => {
    const order = collator.compare(a.tuneTitle, b.tuneTitle)
    return (descending ? -order : order) || compareIds(a.tuneId, b.tuneId)
  })
  for (const group of groups) group.views.sort(ownFirstThenNewestAdded)
  return groups
}

export function arrangeRecordings(
  views: readonly RecordingView[],
  choice: SortChoice,
  query: string,
): Arrangement {
  const needle = query.trim()
  const visible = needle ? views.filter((v) => matches(v, needle)) : [...views]
  const unfiled = visible.filter((v) => !v.tuneId)
  const filed = visible.filter((v) => v.tuneId)

  switch (choice.sort) {
    case 'added':
    case 'recorded': {
      const order = (choice.sort === 'added' ? byAdded : byRecorded)(choice.descending)
      return {
        unfiled: unfiled.sort(order),
        filed: { kind: 'flat', views: filed.sort(order) },
      }
    }
    case 'title': {
      const order = byTitle(choice.descending)
      return {
        unfiled: unfiled.sort(order),
        filed: { kind: 'flat', views: filed.sort(order) },
      }
    }
    case 'tune':
      return {
        unfiled: unfiled.sort(byAddedForAFirst(choice.descending)),
        filed: { kind: 'byTune', groups: groupByTune(filed, choice.descending) },
      }
  }
}

/** Picking the current sort reverses it; picking another starts it at its first direction. */
export function nextSort(current: SortChoice, picked: RecordingSort): SortChoice {
  return nextChoice(current, picked, isDateSort)
}
