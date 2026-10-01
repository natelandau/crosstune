import { IonList } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { LOOP_LIMITS } from '../../api/vocabulary'
import { addLoop, removeLoop, restoreLoop, updateLoop } from '../../commands/loops'
import { LOOP_LIMIT, RECORDING_NOT_FOUND } from '../../commands/messages'
import { useDb } from '../../db/DbProvider'
import { liveTune } from '../../db/tunes'
import type { LocalRecordingLoop } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import { Rail } from '../../ui/Rail'
import { Row } from '../../ui/Row'
import { useToast } from '../../ui/Toast'
import { isControl, isTextEntry, isTopOverlay } from '../../ui/useShortcut'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { formatDuration } from '../recording/format'
import { PANEL_TEXT_BUTTON } from '../recording-screen/panel'
import { trimmedLengthMs } from '../recording-screen/recordingRange'
import type { RecordingView } from '../recordings/useRecordings'
import { canCreate, loopName, partSuggestions, spanFromDrag, type Span } from './loopModel'
import { LOOP_NOT_SAVED } from './PracticeLanes'
import type { LoopPlayback } from './useLoopPlayback'
import { LOOP_NAME } from './practiceCopy'

export const NEW_LOOP = 'New loop'
export const LOOP_DELETED = 'Loop deleted'
export const LOOP_NAME_SUGGESTIONS = 'Suggestions'
export const REPEATING = 'Repeating'
export const DELETE_LOOP = 'Delete'

/** How long a loop New loop makes runs, before the trim range cuts it short. */
export const NEW_LOOP_MS = 4_000

/** `0:58 – 1:51`, a loop's range on the trimmed timeline. */
export function LOOP_RANGE(startMs: number, endMs: number): string {
  return `${formatDuration(startMs)} – ${formatDuration(endMs)}`
}

/**
 * The recording's loops as rows: tap one to select it and frame it, tap the selected one (or
 * press Enter) to name it, swipe or press Delete to remove it with an undo, and New loop to
 * make a four second loop at the playhead.
 */
export function LoopList({
  view,
  loops,
  playback,
  modal,
  cancelRef,
  onFit,
  onError,
}: {
  view: RecordingView
  loops: LocalRecordingLoop[] | undefined
  playback: LoopPlayback
  modal: RefObject<HTMLIonModalElement | null>
  /** Set to what Escape does to an open name field; true when one was open. */
  cancelRef: RefObject<(() => boolean) | null>
  /** Frames a span (source timeline) in the zoomed view. */
  onFit: (span: Span) => void
  onError: (message: string) => void
}) {
  const { recording, file, tuneId } = view
  const db = useDb()
  const engine = usePlaybackEngine()
  const toast = useToast()
  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const rows = loops ?? []
  const trimStartMs = recording.trim_start_ms
  const lengthMs = state.lengthMs > 0 ? state.lengthMs : (trimmedLengthMs(recording, file) ?? 0)
  const bounds = { startMs: trimStartMs, endMs: trimStartMs + lengthMs }
  const create = canCreate(rows.length, bounds)
  const idPrefix = useId()
  const rowId = (id: string) => `${idPrefix}-loop-${id}`
  const newLoopId = `${idPrefix}-new`

  const partStructure = useLiveQuery(
    async () => (tuneId ? (liveTune(await db.tunes.get(tuneId))?.part_structure ?? null) : null),
    [db, tuneId],
  )

  const list = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  if (renaming !== null && loops && !loops.some((l) => l.id === renaming)) setRenaming(null)

  // Focus goes back to a row once it is in the page again: after a rename closes, or to the
  // row that takes a deleted one's place.
  const focusTarget = useRef<string | null>(null)
  useLayoutEffect(() => {
    const id = focusTarget.current
    const element = id === null ? null : document.getElementById(id)
    if (!element) return
    focusTarget.current = null
    // A row put back in place of the name field is a new ion-item, whose slotted button takes
    // no focus until the item has rendered its shadow root.
    // Not cancelled by the next render: a loop's removal renders again before the item is ready.
    const item = element.closest('ion-item')
    void Promise.resolve(item?.componentOnReady?.()).then(() => {
      requestAnimationFrame(() => {
        // Focus the musician moved elsewhere meanwhile stays where they put it.
        const active = document.activeElement
        const free = !active || active === document.body || !!list.current?.contains(active)
        if (element.isConnected && free) element.focus()
      })
    })
  })

  const report = (error: unknown) => {
    if (error instanceof Error && error.message === RECORDING_NOT_FOUND) return
    onError(error instanceof Error && error.message === LOOP_LIMIT ? LOOP_LIMIT : LOOP_NOT_SAVED)
  }

  const choose = (row: LocalRecordingLoop) => {
    if (row.id === playback.selectedId) {
      setRenaming(row.id)
      return
    }
    playback.select(row.id)
    onFit({ startMs: row.start_ms, endMs: row.end_ms })
  }

  /** Closes the name field, saving `text` unless it is null (the name the field opened with). */
  const rename = (row: LocalRecordingLoop, text: string | null, refocus: boolean) => {
    setRenaming(null)
    if (refocus) focusTarget.current = rowId(row.id)
    if (text === null) return
    updateLoop(db, row.id, { label: text.trim() || null }).catch(report)
  }

  /** `fromKey` is a Delete key in Practice, whose focus (a row or a handle) may go with the loop. */
  const remove = (row: LocalRecordingLoop, fromKey = false) => {
    const wasSelected = row.id === playback.selectedId
    const at = rows.findIndex((l) => l.id === row.id)
    const neighbor = rows[at + 1] ?? rows[at - 1]
    if (fromKey || list.current?.contains(document.activeElement)) {
      focusTarget.current = neighbor ? rowId(neighbor.id) : newLoopId
    }
    removeLoop(db, row.id)
      .then(() =>
        toast({
          message: LOOP_DELETED,
          undo: () => {
            restoreLoop(db, row.id)
              .then(() => {
                if (wasSelected) playback.select(row.id)
              })
              .catch(report)
          },
        }),
      )
      .catch((error: unknown) => {
        // The loop stays, and so does the focus it held.
        focusTarget.current = null
        report(error)
      })
  }

  const makeNew = () => {
    if (!create.allowed) return
    const playheadMs = trimStartMs + engine.getState().positionMs
    const span = spanFromDrag(playheadMs, playheadMs + NEW_LOOP_MS, bounds)
    addLoop(db, recording.id, { start_ms: span.startMs, end_ms: span.endMs })
      .then((id) => {
        playback.select(id)
        onFit(span)
      })
      .catch(report)
  }

  const latest = useRef({ rows, playback, renaming, remove })
  useLayoutEffect(() => {
    latest.current = { rows, playback, renaming, remove }
  })
  useLayoutEffect(() => {
    cancelRef.current = () => {
      const { renaming } = latest.current
      if (renaming === null) return false
      setRenaming(null)
      focusTarget.current = rowId(renaming)
      return true
    }
    return () => {
      cancelRef.current = null
    }
    // rowId only joins the stable prefix with its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelRef, idPrefix])

  // Enter names the selected loop and Delete or Backspace removes it, while Practice holds the
  // keyboard and no field does. Enter on a button presses that button instead; a handle is a
  // slider, which has nothing of its own for Enter to do.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key
      if (key !== 'Enter' && key !== 'Delete' && key !== 'Backspace') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if (isTextEntry(event.target) || !isTopOverlay(modal.current)) return
      const { rows, playback, renaming, remove } = latest.current
      const row = rows.find((l) => l.id === playback.selectedId)
      if (!row || renaming !== null) return
      if (key === 'Enter') {
        const target = event.target as HTMLElement | null
        if (isControl(target) && !target?.closest('[role="slider"]')) return
        event.preventDefault()
        setRenaming(row.id)
        return
      }
      event.preventDefault()
      remove(row, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  const usedLabels = rows.map((l) => l.label?.trim()).filter((l): l is string => !!l)
  // Only a recording too short to hold a loop has no reason to give, and then New loop has no use.
  const showNew = create.allowed || create.reason !== null

  return (
    <div ref={list} className="flex flex-col gap-2">
      {rows.length > 0 ? (
        <IonList lines="full">
          {rows.map((row) => {
            const name = loopName(row.label ?? null, row.start_ms, trimStartMs)
            if (row.id === renaming) {
              return (
                <NameField
                  key={row.id}
                  initial={row.label ?? ''}
                  suggestions={partSuggestions(
                    partStructure ?? null,
                    usedLabels.filter((l) => l !== row.label?.trim()),
                  )}
                  onCommit={(text, refocus) => rename(row, text, refocus)}
                />
              )
            }
            const selected = row.id === playback.selectedId
            return (
              <Row
                key={row.id}
                name={name}
                openId={rowId(row.id)}
                current={selected}
                onOpen={() => choose(row)}
                actions={[
                  {
                    label: DELETE_LOOP,
                    icon: Trash2,
                    tone: 'error',
                    onPress: () => remove(row),
                  },
                ]}
                start={
                  <span
                    slot="start"
                    aria-hidden="true"
                    data-loop-dot={row.id}
                    data-color={row.color}
                    className="loop-color pointer-events-none size-3 shrink-0 rounded-full bg-(--loop)"
                  />
                }
              >
                <span className="type-body block truncate">{name}</span>{' '}
                <span className="type-footnote flex gap-2 text-(--ion-color-medium) tabular-nums">
                  <span>{LOOP_RANGE(row.start_ms - trimStartMs, row.end_ms - trimStartMs)}</span>{' '}
                  <span>{formatDuration(row.end_ms - row.start_ms)}</span>
                  {selected && playback.repeat ? (
                    <>
                      {' '}
                      <span className="text-(--ion-color-primary)">{REPEATING}</span>
                    </>
                  ) : null}
                </span>
              </Row>
            )
          })}
        </IonList>
      ) : null}
      {showNew ? (
        <button
          type="button"
          id={newLoopId}
          title={create.reason ?? undefined}
          disabled={!create.allowed || state.lengthMs === 0}
          className={`${PANEL_TEXT_BUTTON} inline-flex items-center gap-2 self-start`}
          onClick={makeNew}
        >
          <Plus aria-hidden="true" className="size-5" />
          {NEW_LOOP}
        </button>
      ) : null}
    </div>
  )
}

/**
 * A loop's name being edited in place, with the tune's parts offered as chips. Enter or a chip
 * saves; leaving the field saves what it holds; Escape (through Practice) closes it unsaved.
 */
function NameField({
  initial,
  suggestions,
  onCommit,
}: {
  initial: string
  suggestions: string[]
  /** Null when the name is the one the field opened with, so a rename made meanwhile on another
   * device is never written over by a field left untouched. */
  onCommit: (text: string | null, refocus: boolean) => void
}) {
  const [text, setText] = useState(initial)
  // The row's label can change while the field is open; untouched means the name it opened with.
  const [opened] = useState(initial)
  const box = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const commit = (value: string, refocus: boolean) => {
    if (done.current) return
    done.current = true
    onCommit(value.trim() === opened.trim() ? null : value, refocus)
  }
  return (
    <div
      ref={box}
      className="flex flex-col gap-2 px-4 py-2"
      // On the box rather than the input, so focus that moves on to a chip and then out still
      // closes the field.
      onBlur={(event) => {
        if (box.current?.contains(event.relatedTarget as Node | null)) return
        // Escape closes the field before its blur arrives, and a closed field saves nothing.
        if (!(event.target as Node).isConnected) return
        commit(text, false)
      }}
    >
      <input
        type="text"
        aria-label={LOOP_NAME}
        maxLength={LOOP_LIMITS.label}
        enterKeyHint="done"
        // The field opens from the musician's own tap or Enter, so it takes the keyboard at once.
        autoFocus
        value={text}
        className="type-body min-h-11 rounded-xl bg-(--fill-tertiary) px-4"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit(text, true)
        }}
      />
      {suggestions.length > 0 ? (
        // Pressing a chip would otherwise take focus from the field first, whose blur saves the
        // typed text before the chip's own name.
        <div onMouseDown={(event) => event.preventDefault()}>
          <Rail label={LOOP_NAME_SUGGESTIONS}>
            {suggestions.map((label) => (
              <Capsule key={label} onPress={() => commit(label, true)}>
                {label}
              </Capsule>
            ))}
          </Rail>
        </div>
      ) : null}
    </div>
  )
}
