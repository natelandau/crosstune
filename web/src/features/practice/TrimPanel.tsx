import { ArrowLeftToLine, ArrowRightToLine, ZoomIn, ZoomOut } from 'lucide-react'
import { TransportMark } from '../../ui/rowGlyphs'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { PAUSE } from '../player/transportCopy'
import type { ShownPeaks } from './recordingRange'
import { GO_TO_END, GO_TO_START, PLAY_SELECTION, PREVIEW_END, SAVE_TRIM } from './trimViewCopy'
import { ZOOM_IN, ZOOM_OUT } from './panel'
import { TRIM } from './trimCopy'
import { TrimReadout, TrimStrips } from './TrimSurface'
import { stripProps, useTrimEditor } from './useTrimEditor'
import type { RecordingView } from '../recordings/useRecordings'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { IconButton } from '../../ui/IconButton'
import { CONTROLS_CAPPED, EditorHeader } from './EditorHeader'
import { Button } from '../../ui/Button'
import type { RefObject } from 'react'

/**
 * Trim in place of practice. The recording page holds the engine at 100% speed and no pitch shift while it shows,
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
  /** True while nothing sits over the editor. */
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
    showInDetail,
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
        onSave={(track) => void save(track)}
      />
      <div data-trim className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        <ErrorLine error={error} place="stack" />
        <TrimStrips {...stripProps(editor)} shown={shown} />
        <div className={`${CONTROLS_CAPPED} flex flex-col gap-5`}>
          <div className="flex items-center gap-2">
            <IconButton
              size="large44"
              icon={ZoomOut}
              label={ZOOM_OUT}
              isDisabled={!canZoomOut}
              onPress={() => zoom('out')}
            />
            <TrimReadout trim={trim} low={low} typeClass="t-secondary" />
            <IconButton
              size="large44"
              icon={ZoomIn}
              label={ZOOM_IN}
              isDisabled={!canZoomIn}
              onPress={() => zoom('in')}
            />
          </div>
          <div data-trim-transport className="flex items-center justify-center gap-8">
            <IconButton
              size="transport"
              icon={ArrowLeftToLine}
              label={GO_TO_START}
              isDisabled={!loaded}
              onPress={() => showInDetail('start')}
            />
            <IconButton
              variant="feature"
              size="feature"
              glyph={<TransportMark shape={playing ? 'pause' : 'play'} className="size-7" />}
              label={playing ? PAUSE : PLAY_SELECTION}
              isDisabled={!loaded}
              onPress={togglePlay}
            />
            <IconButton
              size="transport"
              icon={ArrowRightToLine}
              label={GO_TO_END}
              isDisabled={!loaded}
              onPress={() => showInDetail('end')}
            />
          </div>
          <div className="flex justify-center">
            <Button label={PREVIEW_END} isDisabled={!loaded} onPress={previewEnd} />
          </div>
        </div>
      </div>
    </>
  )
}
