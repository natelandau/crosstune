import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useId, useMemo, type RefObject } from 'react'
import { Button as AriaButton, ToggleButton } from 'react-aria-components'
import { MAX_RECORDING_MS, MAX_SPLIT_PIECES } from '../../domain/recordingLimits'
import type { Moving } from '../player/playheadClock'
import { formatDuration, formatPreciseDuration } from '../../text/format'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { TransportMark } from '../../ui/rowGlyphs'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { SKIP_BACK, SKIP_FORWARD, SKIP_MS } from '../player/playerCopy'
import { PAUSE, PLAY } from '../player/transportCopy'
import type { RecordingView } from '../recordings/useRecordings'
import { CenterLineStrip } from './CenterLineStrip'
import {
  EDITOR_CAPPED,
  EDITOR_FILLED_BUTTON,
  EDITOR_TEXT_BUTTON,
  EditorHeader,
} from './EditorHeader'
import { OverviewStrip } from './OverviewStrip'
import { ZOOM_IN, ZOOM_OUT } from './panel'
import { PracticeButton } from './PracticeButton'
import type { WaveformLoop } from './PracticeWaveform'
import type { ShownPeaks } from './recordingRange'
import {
  NEXT_CUT,
  PIECE_MAX_HINT,
  PIECE_MIN_HINT,
  PIECE_OF,
  PREVIOUS_CUT,
  REMOVE_CUT,
  SAVE_SPLIT,
  SPLIT,
  SPLIT_AT,
} from './splitCopy'
import {
  canSave,
  cutRoom,
  pieceAt,
  pieceColor,
  pieces,
  splitReducer,
  type SplitState,
} from './splitModel'
import { useSplitEditor } from './useSplitEditor'

/**
 * Split in place of practice, on the same practice background, with the header, focus, and
 * Escape of Trim. The overlay holds the engine at 100% speed and no pitch shift while it shows,
 * so what is heard is exactly where a cut falls.
 */
export function SplitPanel({
  view,
  shown,
  isTop,
  stepOutRef,
  onDone,
  onTrimmedElsewhere,
}: {
  view: RecordingView
  /** The peaks for the recording's current trim range. */
  shown: ShownPeaks | null
  /** True while practice is the overlay on top. */
  isTop: () => boolean
  /** Takes the panel's Escape, for a device back to step out the same way. */
  stepOutRef?: RefObject<(() => void) | null>
  /** Saved, or cancelled. */
  onDone: () => void
  /** The row's trim changed while the panel was open, so the cuts no longer line up. */
  onTrimmedElsewhere: () => void
}) {
  const engine = usePlaybackEngine()
  const confirm = useConfirm()
  const editor = useSplitEditor({ view, engine, confirm, onDone, onTrimmedElsewhere, isTop })
  const { split, loaded, playing, shownLineMs, saving } = editor
  const low = split.lowMs
  const all = pieces(split)
  const at = pieceAt(split, shownLineMs)
  const piece = all[at]!
  const pieceMs = piece.endMs - piece.startMs
  const tooLong = (ms: number) => split.overLimit && ms > MAX_RECORDING_MS
  const hintId = useId()
  const hint = all.some((p) => tooLong(p.endMs - p.startMs))
    ? PIECE_MAX_HINT
    : !editor.removes && !editor.canAdd && loaded && all.length < MAX_SPLIT_PIECES
      ? PIECE_MIN_HINT
      : null
  const stepped = (action: { type: 'previous' } | { type: 'next' }) =>
    splitReducer(split, action) !== split

  return (
    <>
      <EditorHeader
        title={SPLIT}
        saveLabel={SAVE_SPLIT}
        isTop={isTop}
        stepOutRef={stepOutRef}
        saving={saving}
        canSave={canSave(split)}
        onDone={onDone}
        onSave={() => void editor.save()}
      />
      <div data-split className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        <ErrorLine error={editor.error} place="stack" />
        <SplitOverview
          split={split}
          shown={shown}
          line={editor.line}
          halfSpanMs={editor.halfSpanMs}
          current={editor.selectedPiece ?? at}
          onSeek={editor.seekTo}
        />
        <CenterLineStrip
          shown={shown}
          lowMs={low}
          highMs={split.highMs}
          line={editor.line}
          valueMs={shownLineMs}
          pxPerS={editor.pxPerS}
          halfSpanMs={editor.halfSpanMs}
          cuts={split.cuts}
          roomOf={(index) => cutRoom(split, index)}
          selectedPiece={editor.selectedPiece}
          boxRef={editor.stripBox}
          pinch={editor.pinch}
          disabled={!loaded}
          onScrubStart={editor.scrubStart}
          onScrub={editor.scrub}
          onScrubEnd={editor.scrubEnd}
          onScrubBy={editor.scrubBy}
          onNudge={editor.nudge}
          onMoveCut={editor.moveCut}
          onTogglePiece={editor.togglePiece}
          onPan={editor.panBy}
          pinches={editor.pinches}
        />
        <div className={`${EDITOR_CAPPED} flex flex-col gap-5`}>
          <div className="flex items-center gap-2">
            <PracticeButton
              icon={ZoomOut}
              iconClassName="size-5"
              label={ZOOM_OUT}
              isDisabled={!editor.canZoomOut}
              onPress={() => editor.zoom('out')}
            />
            <p
              data-split-readout
              className="t-secondary t-num m-0 flex min-w-0 flex-1 flex-wrap justify-center gap-x-3"
            >
              <span data-split-time>{formatPreciseDuration(shownLineMs - low)}</span>
              <span>{PIECE_OF(at + 1, all.length)}</span>
              <span>{formatDuration(pieceMs)}</span>
            </p>
            <PracticeButton
              icon={ZoomIn}
              iconClassName="size-5"
              label={ZOOM_IN}
              isDisabled={!editor.canZoomIn}
              onPress={() => editor.zoom('in')}
            />
          </div>
          <div className="flex flex-col items-center gap-2">
            <AriaButton
              className={`${EDITOR_FILLED_BUTTON} self-stretch`}
              isDisabled={!loaded || (!editor.removes && !editor.canAdd)}
              aria-describedby={hint ? hintId : undefined}
              onPress={editor.pressMain}
            >
              {editor.removes ? REMOVE_CUT : SPLIT_AT(shownLineMs - low)}
            </AriaButton>
            {hint && (
              <p id={hintId} className="t-secondary text-on-practice-secondary m-0 text-center">
                {hint}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AriaButton
              className={EDITOR_TEXT_BUTTON}
              isDisabled={!loaded || !stepped({ type: 'previous' })}
              onPress={editor.previous}
            >
              {PREVIOUS_CUT}
            </AriaButton>
            <AriaButton
              className={EDITOR_TEXT_BUTTON}
              isDisabled={!loaded || !stepped({ type: 'next' })}
              onPress={editor.next}
            >
              {NEXT_CUT}
            </AriaButton>
          </div>
          {split.cuts.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
              {split.cuts.map((cut, index) => (
                <li key={cut}>
                  <ToggleButton
                    data-split-cut
                    isSelected={index === split.selected}
                    isDisabled={!loaded}
                    onChange={() => editor.toggleCut(index)}
                    className={`${EDITOR_TEXT_BUTTON} t-num bg-practice-fill data-selected:bg-on-practice data-selected:text-practice-background`}
                  >
                    {formatPreciseDuration(cut - low)}
                  </ToggleButton>
                </li>
              ))}
            </ul>
          )}
          <div data-split-transport className="flex items-center justify-center gap-6">
            <PracticeButton
              icon={RotateCcw}
              label={SKIP_BACK}
              isDisabled={!loaded}
              onPress={() => editor.skip(-SKIP_MS)}
            />
            <PracticeButton
              size="large"
              glyph={<TransportMark shape={playing ? 'pause' : 'play'} className="size-7" />}
              label={playing ? PAUSE : PLAY}
              isDisabled={!loaded}
              onPress={editor.togglePlay}
            />
            <PracticeButton
              icon={RotateCw}
              label={SKIP_FORWARD}
              isDisabled={!loaded}
              onPress={() => editor.skip(SKIP_MS)}
            />
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The whole trimmed recording with the pieces in loop colors under it, numbered, and
 * a white line at each cut. A tap moves the line there.
 */
function SplitOverview({
  split,
  shown,
  line,
  halfSpanMs,
  current,
  onSeek,
}: {
  split: SplitState
  shown: ShownPeaks | null
  /** The line on the source timeline. */
  line: Moving<number>
  halfSpanMs: number
  /** The selected piece, else the piece the line is in. */
  current: number
  /** `ms` on the source timeline. */
  onSeek: (ms: number) => void
}) {
  const low = split.lowMs
  const lengthMs = split.highMs - low
  const bands = useMemo<WaveformLoop[]>(
    () =>
      // One piece is the whole recording, which needs no tint.
      split.cuts.length === 0
        ? []
        : pieces(split).map((piece, index) => ({
            ...piece,
            id: String(index),
            color: pieceColor(index),
            name: '',
            label: null,
          })),
    [split],
  )
  const playhead = useMemo<Moving<number>>(
    () => ({ get: () => line.get() - low, subscribe: line.subscribe }),
    [line, low],
  )
  const share = (ms: number) => `${lengthMs > 0 ? ((ms - low) / lengthMs) * 100 : 0}%`
  return (
    <div className="relative pt-5">
      <OverviewStrip
        shown={shown}
        lengthMs={lengthMs}
        trimStartMs={low}
        halfSpanMs={halfSpanMs}
        loops={bands}
        playhead={playhead}
        selectedId={String(current)}
        onSeek={(ms) => onSeek(low + ms)}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-5">
        {bands.map((band, index) => (
          <span
            key={band.id}
            className="t-caption t-num text-on-practice absolute top-0 -translate-x-1/2"
            style={{ left: share((band.startMs + band.endMs) / 2) }}
          >
            {index + 1}
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-5 bottom-2">
        {split.cuts.map((cut) => (
          <div
            key={cut}
            className="bg-on-practice absolute inset-y-0 w-0.5 -translate-x-1/2"
            style={{ left: share(cut) }}
          />
        ))}
      </div>
    </div>
  )
}
