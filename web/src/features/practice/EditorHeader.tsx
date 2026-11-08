import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Button as AriaButton, Heading } from 'react-aria-components'
import { CANCEL } from '../../ui/confirmCopy'
import { useOnTop } from '../../ui/overlayClaim'
import { PRESS } from '../../ui/press'
import { useEscapeCapture } from '../../ui/useEscapeCapture'
import { useLatest } from '../../ui/useLatest'
import { BUTTON_CORNER, BUTTON_TONE, UNFILLED_OFF } from '../../ui/buttonTone'
import { CHIP } from './panel'

/** The controls under an editor's strips, capped so they stay in reach on a wide window. */
export const EDITOR_CAPPED = 'mx-auto w-full max-w-xl'

const TEXT_BUTTON = `t-body min-h-(--target) ${BUTTON_CORNER} disabled:opacity-40 ${PRESS}`

/** An editor button's shape, for a button that takes its own colors. */
export const EDITOR_BUTTON_SHAPE = `${TEXT_BUTTON} px-3`

/** A text button with no fill, such as Cancel. */
export const EDITOR_TEXT_BUTTON = `${EDITOR_BUTTON_SHAPE} ${BUTTON_TONE.plain} ${UNFILLED_OFF}`

/** A text button on the panels' round fill, such as Split at 0:12. */
export const EDITOR_FILLED_BUTTON = `${TEXT_BUTTON} px-4 font-semibold ${CHIP}`

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
  onSave: () => void
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
      <AriaButton ref={cancel} className={EDITOR_TEXT_BUTTON} isDisabled={saving} onPress={onDone}>
        {CANCEL}
      </AriaButton>
      <Heading slot="title" className="t-heading min-w-0 flex-1 truncate text-center">
        {title}
      </Heading>
      <AriaButton
        className={`${EDITOR_TEXT_BUTTON} font-semibold`}
        isDisabled={!canSave || saving}
        onPress={onSave}
      >
        {saveLabel}
      </AriaButton>
    </header>
  )
}
