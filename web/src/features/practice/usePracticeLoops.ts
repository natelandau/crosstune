import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import { updateLoop } from '../../commands/loops'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLoop } from '../../db/types'
import { liveTune } from '../../db/tunes'
import type { RecordingView } from '../recordings/useRecordings'
import { loopAt, loopName, resizeSpan, roomAround, rowSpan, spanFields } from './loopModel'
import type { Draft, NewLoop } from './loopModel'
import { NEW_LOOP_REASON } from './LoopsPanel'
import { LOOP_SELECTED } from './practiceCopy'
import type { LaneLoop, SelectedLoop } from './PracticeWaveform'
import { useLoopCommands, type LoopCommands } from './useLoopCommands'
import { useLoopDrafts, type LoopDrafts } from './useLoopDrafts'
import { useLoopPlayback, type LoopPlayback } from './useLoopPlayback'
import { useLoops } from './useLoops'
import type { PracticeKeyActions } from './usePracticeKeys'
import type { PracticeTimeline } from './usePracticeTimeline'

export interface PracticeLoops {
  /** The recording's loops in timeline order, empty until the first read. */
  rows: LocalRecordingLoop[]
  laneLoops: LaneLoop[]
  playback: LoopPlayback
  /** The selected loop as drawn, a handle's drag under way included. */
  selected: SelectedLoop | null
  selectedRow: LocalRecordingLoop | null
  nameOf: (row: LocalRecordingLoop) => string
  commands: LoopCommands
  /** The tune's part structure, which the name suggestions come from. */
  partStructure: string | null
  drafts: LoopDrafts
  onDraft: (draft: Draft | null) => void
  onCommit: (draft: Draft) => void
  /** `[` and `]`: one edge of the selected loop to `atMs`, held to the room around it. */
  setEdge: (edge: 'start' | 'end', atMs: number) => void
  removeSelected: () => void
  renamingId: string | null
  isRenaming: () => boolean
  startRename: (id: string) => void
  endRename: () => void
  commitRename: (id: string, label: string) => void
  /** A tap on the waveform at `sourceMs`: selects the loop there, or deselects outside every loop. */
  onTap: (sourceMs: number) => void
  /** The selected loop's name while paused, which the play button repeats. */
  repeatName: string | null
  /** Why New loop made no loop, in words, or null when it made one. */
  refusedReason: (result: NewLoop) => string | null
  /** N: a loop at `atMs`, or the reason it could not be made said aloud and returned. */
  createAt: (atMs: number) => string | null
  /** Fit, on the selected loop as drawn (a handle's drag under way included), or the whole take. */
  fit: () => void
  /** What practice's keys do, for `usePracticeKeys` with the caller's `isTop` and `blocked`. */
  keyActions: Omit<PracticeKeyActions, 'isTop' | 'blocked'>
}

/**
 * Practice's loops: the rows, the selection, the drafts a handle drag draws, renaming, and the
 * commands the keys and the waveform share. Times are on the source timeline. It frames the
 * timeline's opening view on the selected loop once the loops are read, which sets the
 * timeline's state while rendering, so it runs in the same component as `usePracticeTimeline`
 * and after it. Focus is the component's: `onRemoved` and `onRenameEnd` are where it moves it.
 */
export function usePracticeLoops({
  view,
  timeline,
  announce,
  onError,
  onRemoved,
  onRenameEnd,
}: {
  view: RecordingView
  timeline: PracticeTimeline
  announce: (text: string) => void
  /** A refused write to show in practice. */
  onError: (message: string) => void
  /** After Delete takes the selected loop, whose button goes disabled with it. */
  onRemoved?: () => void
  /** After a rename ends, with the loop it named. */
  onRenameEnd?: (id: string) => void
}): PracticeLoops {
  const { recording, tuneId } = view
  const db = useDb()
  const trimStartMs = recording.trim_start_ms
  const { playheadMs, bounds, playing } = timeline

  const loopRows = useLoops(recording.id)
  const rows = useMemo(() => loopRows ?? [], [loopRows])
  const playback = useLoopPlayback(view, loopRows)
  const partStructure = useLiveQuery(
    async () => (tuneId ? (liveTune(await db.tunes.get(tuneId))?.part_structure ?? null) : null),
    [db, tuneId],
  )
  const commands = useLoopCommands({
    recordingId: recording.id,
    loops: rows,
    playback,
    playheadMs,
    bounds,
    announce,
    onError,
  })
  const selectedRow = commands.selected
  const nameOf = (row: LocalRecordingLoop) => loopName(row.label ?? null, row.start_ms, trimStartMs)

  const laneLoops = useMemo<LaneLoop[]>(
    () =>
      rows.map((loop) => ({
        id: loop.id,
        startMs: loop.start_ms,
        endMs: loop.end_ms,
        color: loop.color,
        name: loopName(loop.label ?? null, loop.start_ms, trimStartMs),
        label: loop.label ?? null,
      })),
    [rows, trimStartMs],
  )

  const { drafts, onDraft, onCommit } = useLoopDrafts({
    rows,
    playback,
    playheadMs,
    onError: commands.report,
  })

  const selected = selectedRow
    ? {
        id: selectedRow.id,
        name: nameOf(selectedRow),
        color: selectedRow.color,
        span: drafts[selectedRow.id]?.span ?? rowSpan(selectedRow),
      }
    : null

  if (loopRows !== undefined) timeline.open(selectedRow ? rowSpan(selectedRow) : null)

  const setEdge = (edge: 'start' | 'end', atMs: number) => {
    if (!selectedRow) return
    const span = rowSpan(selectedRow)
    const others = commands.placed.filter((loop) => loop.id !== selectedRow.id)
    const next = resizeSpan(span, edge, atMs, roomAround(span, others, bounds))
    if (next.startMs === span.startMs && next.endMs === span.endMs) return
    updateLoop(db, selectedRow.id, spanFields(next)).catch(commands.report)
  }

  const removeSelected = () => {
    commands.remove()
    onRemoved?.()
  }

  // The field's own blur after it closes would save again, so a rename ends here exactly once.
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renaming = useRef<string | null>(null)
  const startRename = (id: string) => {
    renaming.current = id
    setRenamingId(id)
  }
  const endRename = () => {
    const id = renaming.current
    renaming.current = null
    setRenamingId(null)
    if (id) onRenameEnd?.(id)
  }
  const commitRename = (id: string, label: string) => {
    if (renaming.current !== id) return
    endRename()
    const row = rows.find((loop) => loop.id === id)
    if (!row || (row.label ?? '') === label) return
    updateLoop(db, id, { label }).catch(commands.report)
  }

  const onTap = (sourceMs: number) => {
    const hit = loopAt(sourceMs, commands.placed)
    if (!hit) {
      if (playback.selectedId) playback.select(null)
      return
    }
    if (hit.id === playback.selectedId) return
    playback.select(hit.id)
    const row = rows.find((loop) => loop.id === hit.id)
    if (row) announce(LOOP_SELECTED(nameOf(row)))
  }

  const nameById = (id: string) => {
    const row = rows.find((loop) => loop.id === id)
    return row ? nameOf(row) : ''
  }
  const refusedReason = (result: NewLoop) => NEW_LOOP_REASON(result, nameById)
  const createAt = (atMs: number) => {
    const reason = refusedReason(commands.create(atMs))
    // New loop's reason is never on screen, so a refused N says why aloud.
    if (reason) announce(reason)
    return reason
  }
  const isRenaming = () => renaming.current !== null
  const selectLoop = (index: number) => {
    const row = rows[index]!
    if (row.id !== playback.selectedId) {
      playback.select(row.id)
      announce(LOOP_SELECTED(nameOf(row)))
    }
    return row.start_ms
  }

  return {
    rows,
    laneLoops,
    playback,
    selected,
    selectedRow,
    nameOf,
    commands,
    partStructure: partStructure ?? null,
    drafts,
    onDraft,
    onCommit,
    setEdge,
    removeSelected,
    renamingId,
    isRenaming,
    startRename,
    endRename,
    commitRename,
    onTap,
    repeatName: selected && !playing ? selected.name : null,
    refusedReason,
    createAt,
    fit: () => timeline.fit(selected?.span ?? null),
    keyActions: {
      canEdit: timeline.audioReady,
      trimStartMs,
      settle: timeline.settle,
      shownPositionMs: timeline.shownPositionMs,
      selectedId: selectedRow?.id ?? null,
      isRenaming,
      togglePlay: timeline.togglePlay,
      setEdge,
      create: createAt,
      loopCount: rows.length,
      selectLoop,
      removeSelected,
      startRename,
      endRename,
      deselect: () => playback.select(null),
      zoom: timeline.zoom,
    },
  }
}
