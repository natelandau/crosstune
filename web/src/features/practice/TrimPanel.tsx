import { ArrowLeftToLine, ArrowRightToLine, ZoomIn, ZoomOut } from 'lucide-react'
import { TransportMark } from '../../ui/rowGlyphs'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { PAUSE } from '../player/transportCopy'
import type { ShownPeaks } from './recordingRange'
import {
  GO_TO_END,
  GO_TO_START,
  PLAY_SELECTION,
  PREVIEW_END,
  SAVE_TRIM,
  SET_END,
  SET_START,
} from './trimViewCopy'
import { ZOOM_IN, ZOOM_OUT } from './panel'
import { TRIM } from './trimCopy'
import { TrimReadout, TrimStrips } from './TrimSurface'
import { stripProps, useTrimEditor } from './useTrimEditor'
import type { RecordingView } from '../recordings/useRecordings'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { PracticeButton } from './PracticeButton'
import {
  EDITOR_CAPPED,
  EDITOR_FILLED_BUTTON,
  EDITOR_TEXT_BUTTON,
  EditorHeader,
} from './EditorHeader'
import { Button as AriaButton } from 'react-aria-components'
import type { RefObject } from 'react'

/**
 * Trim in place of practice, on the same practice background with white handles, so editing reads apart
 * from practice. The overlay holds the engine at 100% speed and no pitch shift while it shows,
 * so what is heard is exactly what is cut. Escape steps back out to practice, as Cancel does,
 * except while a confirmed trim is being written, which then finishes and leaves on its own.
 */
export function TrimPanel({
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
  /** The row's trim changed while the panel was open, so the handles no longer line up. */
  onTrimmedElsewhere: () => void
}) {
  const engine = usePlaybackEngine()
  const confirm = useConfirm()
  const editor = useTrimEditor({
    view,
    engine,
    confirm,
    onDone,
    onTrimmedElsewhere,
    isTop,
  })
  const {
    trim,
    low,
    loaded,
    playing,
    changed,
    goTo,
    setAtPlayhead,
    togglePlay,
    previewEnd,
    zoom,
    canZoomIn,
    canZoomOut,
    save,
    saving,
    error,
  } = editor

  return (
    <>
      <EditorHeader
        title={TRIM}
        saveLabel={SAVE_TRIM}
        isTop={isTop}
        stepOutRef={stepOutRef}
        saving={saving}
        canSave={changed}
        onDone={onDone}
        onSave={() => void save()}
      />
      <div data-trim className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        <ErrorLine error={error} place="stack" />
        <TrimStrips {...stripProps(editor)} shown={shown} />
        <div className={`${EDITOR_CAPPED} flex flex-col gap-5`}>
          <div className="flex items-center gap-2">
            <PracticeButton
              icon={ZoomOut}
              iconClassName="size-5"
              label={ZOOM_OUT}
              isDisabled={!canZoomOut}
              onPress={() => zoom('out')}
            />
            <TrimReadout trim={trim} low={low} typeClass="t-secondary" />
            <PracticeButton
              icon={ZoomIn}
              iconClassName="size-5"
              label={ZOOM_IN}
              isDisabled={!canZoomIn}
              onPress={() => zoom('in')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AriaButton
              className={EDITOR_FILLED_BUTTON}
              isDisabled={!loaded}
              onPress={() => setAtPlayhead('start')}
            >
              {SET_START}
            </AriaButton>
            <AriaButton
              className={EDITOR_FILLED_BUTTON}
              isDisabled={!loaded}
              onPress={() => setAtPlayhead('end')}
            >
              {SET_END}
            </AriaButton>
          </div>
          <div data-trim-transport className="flex items-center justify-center gap-6">
            <PracticeButton
              icon={ArrowLeftToLine}
              iconClassName="size-7"
              label={GO_TO_START}
              isDisabled={!loaded}
              onPress={() => goTo('start')}
            />
            <PracticeButton
              size="large"
              glyph={<TransportMark shape={playing ? 'pause' : 'play'} className="size-7" />}
              label={playing ? PAUSE : PLAY_SELECTION}
              isDisabled={!loaded}
              onPress={togglePlay}
            />
            <PracticeButton
              icon={ArrowRightToLine}
              iconClassName="size-7"
              label={GO_TO_END}
              isDisabled={!loaded}
              onPress={() => goTo('end')}
            />
          </div>
          <AriaButton
            className={`${EDITOR_TEXT_BUTTON} self-center`}
            isDisabled={!loaded}
            onPress={previewEnd}
          >
            {PREVIEW_END}
          </AriaButton>
        </div>
      </div>
    </>
  )
}
