import { ArrowLeftToLine, ArrowRightToLine, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Button as AriaButton, Heading } from 'react-aria-components'
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
import { CANCEL } from '../../ui/confirmCopy'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { useLatest } from '../../ui/useLatest'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { useOnTop } from '../../ui/overlayClaim'
import { PracticeButton } from './PracticeButton'

/** The controls under the strips, capped so they stay in reach on a wide window. */
const CAPPED = 'mx-auto w-full max-w-xl'

const TEXT_BUTTON =
  't-body min-h-(--target) rounded-(--radius-capsule) text-(--panel-ink) transition-opacity duration-(--dur-short) ease-(--ease) disabled:opacity-40 data-[pressed]:opacity-60'

const HEADER_TEXT_BUTTON = `${TEXT_BUTTON} px-3`

const FILLED_TEXT_BUTTON = `${TEXT_BUTTON} bg-(--fill-tertiary) px-4 font-semibold`

/**
 * Trim in place of practice, on the same jet ground with white handles, so editing reads apart
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

  // Focus lands on Cancel once More's menu has let go, since the menu hands focus back to its
  // trigger as it leaves, and the trigger has gone with practice's header.
  const top = useOnTop(isTop)
  const cancel = useRef<HTMLButtonElement>(null)
  const entered = useRef(false)
  useEffect(() => {
    if (!top || entered.current) return
    entered.current = true
    cancel.current?.focus()
  }, [top])

  const onDoneRef = useLatest(onDone)
  const savingRef = useLatest(saving)
  const stepOut = useCallback(() => {
    if (!savingRef.current) onDoneRef.current()
  }, [onDoneRef, savingRef])
  useEffect(() => {
    if (stepOutRef) stepOutRef.current = stepOut
  }, [stepOut, stepOutRef])
  useEscapeCapture(stepOut, { when: isTop })

  return (
    <>
      <header data-trim-header className="flex items-center gap-2 px-2 py-2">
        <AriaButton
          ref={cancel}
          className={HEADER_TEXT_BUTTON}
          isDisabled={saving}
          onPress={onDone}
        >
          {CANCEL}
        </AriaButton>
        <Heading slot="title" className="t-heading min-w-0 flex-1 truncate text-center">
          {TRIM}
        </Heading>
        <AriaButton
          className={`${HEADER_TEXT_BUTTON} font-semibold`}
          isDisabled={!changed || saving}
          onPress={() => void save()}
        >
          {SAVE_TRIM}
        </AriaButton>
      </header>
      <div data-trim className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
        <ErrorLine error={error} place="stack" />
        <TrimStrips {...stripProps(editor)} shown={shown} />
        <div className={`${CAPPED} flex flex-col gap-5`}>
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
              className={FILLED_TEXT_BUTTON}
              isDisabled={!loaded}
              onPress={() => setAtPlayhead('start')}
            >
              {SET_START}
            </AriaButton>
            <AriaButton
              className={FILLED_TEXT_BUTTON}
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
              icon={playing ? Pause : Play}
              iconClassName={playing ? 'size-8' : 'ml-1 size-8 fill-current'}
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
            className={`${HEADER_TEXT_BUTTON} self-center`}
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
