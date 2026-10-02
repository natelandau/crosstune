import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { useDb } from '../../db/DbProvider'
import { updateLoop } from '../../commands/loops'
import { LOOP_LIMIT, NO_ROOM } from '../../commands/messages'
import type { LocalRecordingLoop } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import { Rail } from '../../ui/Rail'
import { PANEL_TEXT_BUTTON, PANEL_TEXT_BUTTON_SHAPE } from '../recording-screen/panel'
import { loopName, partSuggestions, type Bounds, type NewLoop } from './loopModel'
import {
  DELETE_LOOP,
  INSIDE_LOOP,
  LOOP_NAME_SUGGESTIONS,
  LOOPS_EMPTY_HINT,
  NEW_LOOP,
} from './practiceCopy'
import { useLoopCommands } from './useLoopCommands'
import type { LoopPlayback } from './useLoopPlayback'

/** Why New loop is off, or null when it would make a loop. */
export function NEW_LOOP_REASON(result: NewLoop, nameOf: (id: string) => string): string | null {
  switch (result.kind) {
    case 'span':
      return null
    case 'inside':
      return INSIDE_LOOP(nameOf(result.id))
    case 'noRoom':
      return NO_ROOM
    case 'atCap':
      return LOOP_LIMIT
  }
}

/**
 * The Loops mode: make a loop at the playhead, or delete the selected one. Times are on the
 * source timeline; `loops` is sorted by start.
 */
export function LoopsPanel({
  recordingId,
  loops,
  playback,
  playheadMs,
  bounds,
  renamingId,
  partStructure,
  canCreate = true,
  onCommand,
  onCreated,
  onError,
  announce,
  onSuggestion,
  onRemoved,
}: {
  recordingId: string
  loops: readonly LocalRecordingLoop[]
  playback: LoopPlayback
  playheadMs: number
  /** The trim range. */
  bounds: Bounds
  /** The loop whose name field is open, if any. */
  renamingId: string | null
  partStructure: string | null
  /** False while there is no audio to place a loop by, which turns New loop off. */
  canCreate?: boolean
  /**
   * Runs ahead of every command, so it acts where the playhead shows. Returns the source time the
   * playhead settled at, where New loop goes.
   */
  onCommand?: () => number | void
  onCreated: (id: string) => void
  onError: (message: string) => void
  announce: (text: string) => void
  /** A suggestion chip was pressed for the loop being renamed, after its label was written. */
  onSuggestion?: (label: string) => void
  /** Delete loop was pressed and the selected loop is on its way out. */
  onRemoved?: () => void
}) {
  const db = useDb()
  const reasonId = useId()
  const commands = useLoopCommands({
    recordingId,
    loops,
    playback,
    playheadMs,
    bounds,
    announce,
    onCreated,
    onError,
  })
  const { result, selected, create, report } = commands
  const nameOf = (row: LocalRecordingLoop) =>
    loopName(row.label ?? null, row.start_ms, bounds.startMs)
  const nameById = (id: string) => {
    const row = loops.find((l) => l.id === id)
    return row ? nameOf(row) : ''
  }

  // With no audio the player's own status says why, so New loop gives no reason of its own.
  const reason = canCreate ? NEW_LOOP_REASON(result, nameById) : null
  const remove = () => {
    onCommand?.()
    commands.remove()
    onRemoved?.()
  }

  const usedLabels = loops
    .filter((l) => l.id !== renamingId)
    .map((l) => l.label?.trim())
    .filter((l): l is string => !!l)
  const suggestions = renamingId ? partSuggestions(partStructure, usedLabels) : []
  const showHint = loops.length === 0 && canCreate && reason === null

  return (
    <div data-loops-panel className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={!canCreate || result.kind !== 'span'}
          aria-describedby={reason ? reasonId : undefined}
          className={`${PANEL_TEXT_BUTTON} inline-flex items-center gap-2`}
          onClick={() => {
            create(onCommand?.() ?? undefined)
          }}
        >
          <Plus aria-hidden="true" className="size-5" />
          {NEW_LOOP}
        </button>
        <button
          type="button"
          disabled={!selected}
          className={`${PANEL_TEXT_BUTTON_SHAPE} inline-flex items-center gap-2 ${selected ? 'text-(--ion-color-danger)' : 'text-(--ion-color-medium)'}`}
          onClick={remove}
        >
          <Trash2 aria-hidden="true" className="size-5" />
          {DELETE_LOOP}
        </button>
      </div>
      {reason ? (
        <p id={reasonId} className="sr-only">
          {reason}
        </p>
      ) : null}
      {showHint ? (
        <p className="type-footnote text-center text-(--ion-color-medium)">{LOOPS_EMPTY_HINT}</p>
      ) : null}
      {suggestions.length > 0 && renamingId ? (
        // A chip press would take focus from the name field first, whose blur saves the typed
        // text before the chip's own name.
        <div onMouseDown={(event) => event.preventDefault()}>
          <Rail label={LOOP_NAME_SUGGESTIONS}>
            {suggestions.map((label) => (
              <Capsule
                key={label}
                onPress={() => {
                  updateLoop(db, renamingId, { label }).catch(report)
                  onSuggestion?.(label)
                }}
              >
                {label}
              </Capsule>
            ))}
          </Rail>
        </div>
      ) : null}
    </div>
  )
}
