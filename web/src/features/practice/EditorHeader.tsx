import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Heading } from 'react-aria-components'
import { Button } from '../../ui/Button'
import { CANCEL } from '../../ui/confirmCopy'
import { useOnTop } from '../../ui/overlayClaim'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { useLatest } from '../../ui/useLatest'
import type { TrackWork } from '../../ui/useWorking'

/** The controls under an editor's strips, capped so they stay in reach on a wide window. */
export const CONTROLS_CAPPED = 'mx-auto w-full max-w-xl'

/**
 * An editor shown in place of practice, such as Trim or Split: Cancel, the title, and Save. Cancel
 * takes focus once More's menu has let go, since the menu hands focus back to its trigger as it
 * leaves, and the trigger has gone with practice's header. Escape steps back out to practice, as
 * Cancel does, except while a confirmed edit is being written, which then finishes and leaves on
 * its own.
 */
export function EditorHeader({
  title,
  saveLabel,
  isTop,
  stepOutRef,
  saving,
  canSave,
  onDone,
  onSave,
}: {
  title: string
  saveLabel: string
  /** True while nothing sits over the editor. */
  isTop: () => boolean
  /** Takes the editor's Escape, for a device back to step out the same way. */
  stepOutRef?: RefObject<(() => void) | null>
  saving: boolean
  canSave: boolean
  /** Cancelled. */
  onDone: () => void
  /** The save, which hands its write to `track` and ends with the editor leaving. */
  onSave: (track: TrackWork) => void
}) {
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
    <header data-editor-header className="flex items-center gap-2 px-2 py-2">
      <Button ref={cancel} label={CANCEL} isDisabled={saving} onPress={onDone} />
      <Heading slot="title" className="t-heading min-w-0 flex-1 truncate text-center">
        {title}
      </Heading>
      <Button
        variant="primary"
        label={saveLabel}
        isDisabled={!canSave}
        showDone={false}
        onPress={onSave}
      />
    </header>
  )
}
